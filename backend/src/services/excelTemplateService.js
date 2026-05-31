const ExcelJS = require('exceljs');

async function generateTemplate() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Leads');

  worksheet.addRow([
    'Company',
    'Contact',
    'Assign To',
    'Score',
    'Status',
    'Product / Service',
    'Source URL',
    'Next Follow-up',
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { generateTemplate };
