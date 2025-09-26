import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../context/AuthContext';
import { DailyOrder } from '../types';
import { IndianRupee, ShoppingCart, CheckCircle, Clock, FileText, FileDown, FileSpreadsheet, Loader2, User } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface CustomerStatement {
  customerId: string;
  customerName: string;
  orders: DailyOrder[];
  totalAmount: number;
  totalPaid: number;
  pendingAmount: number;
}

interface StatementResult {
  customerStatements: CustomerStatement[];
  grandTotalAmount: number;
  grandTotalPaid: number;
  grandTotalPending: number;
  totalOrders: number;
}

const Statement: React.FC = () => {
  const { orders, customers, products, dataLoading } = useAuth();

  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [selectedCustomerId, setSelectedCustomerId] = useState('all');
  const [generatedStatement, setGeneratedStatement] = useState<StatementResult | null>(null);

  const handleGenerateStatement = () => {
    const filteredOrders = orders.filter(order => {
      const orderDate = new Date(order.date);
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      orderDate.setUTCHours(0, 0, 0, 0);
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCHours(0, 0, 0, 0);

      const isDateInRange = orderDate >= start && orderDate <= end;
      const isCustomerMatch = selectedCustomerId === 'all' || order.customer_id === selectedCustomerId;
      
      return isDateInRange && isCustomerMatch;
    });

    let customerStatements: CustomerStatement[] = [];

    if (selectedCustomerId === 'all') {
      const ordersByCustomer = filteredOrders.reduce((acc, order) => {
        (acc[order.customer_id] = acc[order.customer_id] || []).push(order);
        return acc;
      }, {} as Record<string, DailyOrder[]>);

      customerStatements = Object.entries(ordersByCustomer).map(([customerId, customerOrders]) => {
        const totalAmount = customerOrders.reduce((sum, o) => sum + o.total_amount, 0);
        const totalPaid = customerOrders.reduce((sum, o) => sum + (o.amount_paid || 0), 0);
        return {
          customerId,
          customerName: customerOrders[0]?.customer_name || 'Unknown',
          orders: customerOrders.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
          totalAmount,
          totalPaid,
          pendingAmount: totalAmount - totalPaid,
        };
      });
    } else {
      const customerOrders = filteredOrders.filter(o => o.customer_id === selectedCustomerId);
      if (customerOrders.length > 0) {
          const totalAmount = customerOrders.reduce((sum, o) => sum + o.total_amount, 0);
          const totalPaid = customerOrders.reduce((sum, o) => sum + (o.amount_paid || 0), 0);
          customerStatements.push({
              customerId: selectedCustomerId,
              customerName: customers.find(c => c.id === selectedCustomerId)?.name || 'Unknown',
              orders: customerOrders.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
              totalAmount,
              totalPaid,
              pendingAmount: totalAmount - totalPaid,
          });
      }
    }

    const grandTotalAmount = customerStatements.reduce((sum, cs) => sum + cs.totalAmount, 0);
    const grandTotalPaid = customerStatements.reduce((sum, cs) => sum + cs.totalPaid, 0);
    
    setGeneratedStatement({
      customerStatements: customerStatements.sort((a, b) => a.customerName.localeCompare(b.customerName)),
      grandTotalAmount,
      grandTotalPaid,
      grandTotalPending: grandTotalAmount - grandTotalPaid,
      totalOrders: filteredOrders.length,
    });
  };

  const handleDownloadDailyFullReport = () => {
    const todayOrders = orders.filter(order => order.date === today);

    // Financial Summary Sheet
    const totalCollectionToday = todayOrders.reduce((sum, order) => sum + (order.amount_paid || 0), 0);
    const totalAmountToday = todayOrders.reduce((sum, order) => sum + order.total_amount, 0);
    const totalPendingToday = totalAmountToday - totalCollectionToday;
    const financialSummaryData = [
      ["Metric", "Value"],
      ["Total Amount", `₹${totalAmountToday.toFixed(2)}`],
      ["Today's Collection", `₹${totalCollectionToday.toFixed(2)}`],
      ["Today's Pending", `₹${totalPendingToday.toFixed(2)}`],
      ["Total Orders Today", todayOrders.length],
    ];
    const financialWs = XLSX.utils.aoa_to_sheet(financialSummaryData);
    financialWs['!cols'] = [{wch: 20}, {wch: 15}];

    // Customer Summary Sheet
    const customerSummary = todayOrders.reduce((acc, order) => {
      if (!acc[order.customer_id]) {
        acc[order.customer_id] = { name: order.customer_name, total: 0, paid: 0 };
      }
      acc[order.customer_id].total += order.total_amount;
      acc[order.customer_id].paid += order.amount_paid || 0;
      return acc;
    }, {} as Record<string, { name: string, total: number, paid: number }>);
    const customerSummaryData = [
        ["Customer Name", "Total Amount", "Amount Paid", "Pending Amount"],
        ...Object.values(customerSummary).map(c => [ c.name, c.total, c.paid, c.total - c.paid ])
    ];
    const customerWs = XLSX.utils.aoa_to_sheet(customerSummaryData);
    customerWs['!cols'] = [{wch: 25}, {wch: 15}, {wch: 15}, {wch: 15}];

    // Product Summary Sheet
    const productSummary: { [productName: string]: { quantity: number; unit: string } } = {};
    todayOrders.forEach(order => {
        order.items.forEach(item => {
            const product = products.find(p => p.id === item.product_id);
            const baseUnit = product?.unit || 'units';
            let displayUnit = baseUnit === 'piece' ? 'pcs' : (baseUnit === 'ml' ? '' : baseUnit);
            if (!productSummary[item.product_name]) {
                productSummary[item.product_name] = { quantity: 0, unit: displayUnit };
            }
            productSummary[item.product_name].quantity += item.quantity;
        });
    });
    const productSummaryData = [
        ["Product Name", "Total Quantity Sold"],
        ...Object.entries(productSummary).map(([name, {quantity, unit}]) => [ name, `${quantity} ${unit}`.trim() ])
    ];
    const productWs = XLSX.utils.aoa_to_sheet(productSummaryData);
    productWs['!cols'] = [{wch: 30}, {wch: 20}];

    // All Orders Detailed Sheet
    const allOrdersData = [
        ["Date", "Customer Name", "Product Name", "Quantity", "Unit", "Price per Unit", "Total Price", "Status"],
        ...todayOrders.flatMap(order => 
            order.items.map(item => [ order.date, order.customer_name, item.product_name, item.quantity, item.unit, item.price, item.total, order.status ])
        )
    ];
    const allOrdersWs = XLSX.utils.aoa_to_sheet(allOrdersData);
    allOrdersWs['!cols'] = [{wch: 12}, {wch: 25}, {wch: 30}, {wch: 10}, {wch: 10}, {wch: 15}, {wch: 15}, {wch: 12}];

    // Create workbook and download
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, financialWs, "Financial Summary");
    XLSX.utils.book_append_sheet(wb, customerWs, "Customer Summary");
    XLSX.utils.book_append_sheet(wb, productWs, "Product Summary");
    XLSX.utils.book_append_sheet(wb, allOrdersWs, "All Orders Detailed");
    XLSX.writeFile(wb, `Daily_Full_Report_${today}.xlsx`);
  };

  const handleDownloadPDF = () => {
    if (!generatedStatement) return;
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.text('Jay Goga Milk - Statement', 14, 22);
    doc.setFontSize(11);
    doc.text(`Period: ${startDate} to ${endDate}`, 14, 30);

    doc.setFontSize(14);
    doc.text('Overall Summary', 14, 45);
    doc.setFontSize(10);
    doc.text(`Total Order Value: ₹${generatedStatement.grandTotalAmount.toFixed(2)}`, 14, 52);
    doc.text(`Total Paid: ₹${generatedStatement.grandTotalPaid.toFixed(2)}`, 14, 58);
    doc.text(`Pending Amount: ₹${generatedStatement.grandTotalPending.toFixed(2)}`, 14, 64);

    let yPos = 75;

    generatedStatement.customerStatements.forEach(cs => {
        if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(`Customer: ${cs.customerName}`, 14, yPos);
        yPos += 7;

        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text(`Total: ₹${cs.totalAmount.toFixed(2)} | Paid: ₹${cs.totalPaid.toFixed(2)} | Pending: ₹${cs.pendingAmount.toFixed(2)}`, 14, yPos);
        yPos += 5;

        const tableColumn = ["Date", "Items", "Total", "Paid", "Balance", "Status"];
        const tableRows = cs.orders.map(order => [
            new Date(order.date).toLocaleDateString('en-IN', { timeZone: 'UTC' }),
            order.items.map(i => `${i.product_name} x${i.quantity}`).join('\n'),
            `₹${order.total_amount.toFixed(2)}`,
            `₹${(order.amount_paid || 0).toFixed(2)}`,
            `₹${(order.total_amount - (order.amount_paid || 0)).toFixed(2)}`,
            order.status,
        ]);

        (doc as any).autoTable({
            head: [tableColumn],
            body: tableRows,
            startY: yPos,
            theme: 'grid',
            headStyles: { fillColor: [2, 132, 199] }, // dairy-600
        });

        yPos = (doc as any).lastAutoTable.finalY + 15;
    });

    const customerName = selectedCustomerId === 'all' 
        ? 'All_Customers' 
        : customers.find(c => c.id === selectedCustomerId)?.name.replace(/\s+/g, '_') || 'Customer';

    doc.save(`Statement_${customerName}_${startDate}_to_${endDate}.pdf`);
  };

  const handleDownloadExcel = () => {
    if (!generatedStatement) return;
    
    const ws_data: (string | number)[][] = [
      ["Jay Goga Milk - Statement"],
      [`Period: ${startDate} to ${endDate}`],
      [],
      ["Overall Summary"],
      ["Total Order Value", generatedStatement.grandTotalAmount],
      ["Total Paid", generatedStatement.grandTotalPaid],
      ["Pending Amount", generatedStatement.grandTotalPending],
      [],
    ];

    generatedStatement.customerStatements.forEach(cs => {
        ws_data.push([`Customer: ${cs.customerName}`]);
        ws_data.push(["Customer Total", cs.totalAmount, "Customer Paid", cs.totalPaid, "Customer Pending", cs.pendingAmount]);
        ws_data.push(["Date", "Items", "Total", "Paid", "Balance", "Status"]);
        cs.orders.forEach(order => {
            ws_data.push([
                new Date(order.date).toLocaleDateString('en-IN', { timeZone: 'UTC' }),
                order.items.map(i => `${i.product_name} x ${i.quantity}`).join(', '),
                order.total_amount,
                order.amount_paid || 0,
                order.total_amount - (order.amount_paid || 0),
                order.status,
            ]);
        });
        ws_data.push([]);
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!cols'] = [{wch:12}, {wch:40}, {wch:10}, {wch:10}, {wch:10}, {wch:10}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Statement");

    const customerName = selectedCustomerId === 'all' 
        ? 'All_Customers' 
        : customers.find(c => c.id === selectedCustomerId)?.name.replace(/\s+/g, '_') || 'Customer';

    XLSX.writeFile(wb, `Statement_${customerName}_${startDate}_to_${endDate}.xlsx`);
  };

  const grandStats = useMemo(() => {
    if (!generatedStatement) return [];
    return [
      { icon: IndianRupee, label: 'Grand Total Value', value: `₹${generatedStatement.grandTotalAmount.toFixed(2)}`, color: 'bg-blue-100 text-blue-600' },
      { icon: CheckCircle, label: 'Grand Total Paid', value: `₹${generatedStatement.grandTotalPaid.toFixed(2)}`, color: 'bg-green-100 text-green-600' },
      { icon: Clock, label: 'Grand Pending', value: `₹${generatedStatement.grandTotalPending.toFixed(2)}`, color: 'bg-orange-100 text-orange-600' },
      { icon: ShoppingCart, label: 'Total Orders', value: generatedStatement.totalOrders, color: 'bg-purple-100 text-purple-600' },
    ];
  }, [generatedStatement]);

  return (
    <Layout title="Statement">
      <div className="px-4">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl p-4 mb-6 shadow-sm border border-gray-100"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-4">Generate Statement</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-dairy-500"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-dairy-500"/>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <select value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-dairy-500">
                <option value="all">All Customers</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <motion.button
              onClick={handleGenerateStatement}
              disabled={dataLoading}
              className="w-full bg-dairy-600 text-white py-3 rounded-lg font-medium flex justify-center items-center"
              whileTap={{ scale: 0.98 }}
            >
              {dataLoading ? <Loader2 className="animate-spin" /> : 'Generate Statement'}
            </motion.button>
          </div>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl p-4 mb-6 shadow-sm border border-gray-100"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-2">Daily Full Report</h2>
          <p className="text-gray-600 mb-4">Download a complete Excel report of all data for today, {today}.</p>
          <motion.button
            onClick={handleDownloadDailyFullReport}
            disabled={dataLoading}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-medium flex justify-center items-center space-x-2"
            whileTap={{ scale: 0.98 }}
          >
            {dataLoading ? <Loader2 className="animate-spin" /> : (
              <>
                <FileSpreadsheet size={20} />
                <span>Download Today's Report</span>
              </>
            )}
          </motion.button>
        </motion.div>

        <AnimatePresence>
          {generatedStatement && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="grid grid-cols-2 gap-4 mb-6">
                {grandStats.map((stat, index) => (
                  <motion.div key={stat.label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * 0.1 }} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <div className={`p-2 rounded-lg inline-block ${stat.color} mb-2`}><stat.icon size={20} /></div>
                    <p className="text-xl md:text-2xl font-bold text-gray-800 truncate">{stat.value}</p>
                    <p className="text-xs text-gray-600">{stat.label}</p>
                  </motion.div>
                ))}
              </div>

              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Details</h3>
                <div className="flex space-x-2">
                  <motion.button onClick={handleDownloadPDF} className="flex items-center space-x-2 bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm font-medium" whileTap={{scale: 0.95}}><FileDown size={16}/><span>PDF</span></motion.button>
                  <motion.button onClick={handleDownloadExcel} className="flex items-center space-x-2 bg-green-50 text-green-700 px-3 py-2 rounded-lg text-sm font-medium" whileTap={{scale: 0.95}}><FileSpreadsheet size={16}/><span>Excel</span></motion.button>
                </div>
              </div>
              
              {generatedStatement.customerStatements.length > 0 ? (
                <div className="space-y-6">
                  {generatedStatement.customerStatements.map(cs => (
                    <div key={cs.customerId} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                      <div className="flex items-center justify-between mb-4 pb-4 border-b">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center"><User size={20} className="mr-2 text-dairy-700"/>{cs.customerName}</h3>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                        <div className="p-2 bg-gray-50 rounded-lg"><p className="text-xs text-gray-500">Total</p><p className="font-bold text-sm text-gray-800">₹{cs.totalAmount.toFixed(2)}</p></div>
                        <div className="p-2 bg-green-50 rounded-lg"><p className="text-xs text-green-700">Paid</p><p className="font-bold text-sm text-green-600">₹{cs.totalPaid.toFixed(2)}</p></div>
                        <div className="p-2 bg-red-50 rounded-lg"><p className="text-xs text-red-700">Pending</p><p className="font-bold text-sm text-red-600">₹{cs.pendingAmount.toFixed(2)}</p></div>
                      </div>
                      <div className="space-y-3">
                        {cs.orders.map(order => (
                          <div key={order.id} className="bg-gray-50 rounded-lg p-3">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <p className="font-semibold text-gray-700">{new Date(order.date).toLocaleDateString('en-IN', { timeZone: 'UTC' })}</p>
                                <p className="text-xs text-gray-500">Order ID: ...{order.id.slice(-6)}</p>
                              </div>
                              <span className={`inline-block px-2 py-1 text-xs rounded-full ${order.status === 'delivered' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>{order.status}</span>
                            </div>
                            <div className="text-xs text-gray-600 space-y-1 my-2 pl-2 border-l-2 border-dairy-200">
                              {order.items.map((item, idx) => (<p key={idx}>{item.product_name} (x{item.quantity}) - ₹{item.total.toFixed(2)}</p>))}
                            </div>
                            <div className="mt-2 pt-2 border-t space-y-1 text-sm">
                              <div className="flex justify-between"><span className="text-gray-600">Total:</span><span className="font-medium">₹{order.total_amount.toFixed(2)}</span></div>
                              <div className="flex justify-between"><span className="text-gray-600">Paid:</span><span className="font-medium text-green-600">₹{(order.amount_paid || 0).toFixed(2)}</span></div>
                              <div className="flex justify-between"><span className="text-gray-600">Balance:</span><span className={`font-bold ${(order.total_amount - (order.amount_paid || 0)) <= 0 ? 'text-green-700' : 'text-red-600'}`}>₹{(order.total_amount - (order.amount_paid || 0)).toFixed(2)}</span></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-gray-100">
                  <FileText className="mx-auto text-gray-300 mb-4" size={48} />
                  <p className="text-gray-600">No orders found for the selected criteria.</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Layout>
  );
};

export default Statement;
