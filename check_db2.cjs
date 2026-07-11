const { createClient } = require('@libsql/client');

const client = createClient({
  url: 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN || ''
});

async function main() {
  const rs = await client.execute('SELECT * FROM paletes WHERE codigo = "PLT-0031"');
  console.log(rs.rows);
}
main();
