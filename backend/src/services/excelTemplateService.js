const XLSX = require('xlsx');

function generateTemplate() {
  const headers = [
    'Company',
    'Contact',
    'Assign To',
    'Score',
    'Status',
    'Product / Service',
    'Source URL',
    'Next Follow-up',
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generateTemplate };
