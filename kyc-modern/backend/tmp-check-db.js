const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'kyc_v4',
  });

  try {
    const [rows] = await conn.query('SHOW TABLES LIKE ?', ['dossiers']);
    console.log('TABLE_EXISTS', JSON.stringify(rows));
    const [countRows] = await conn.query('SELECT COUNT(*) as n FROM dossiers');
    console.log('COUNT', JSON.stringify(countRows));
  } finally {
    await conn.end();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
