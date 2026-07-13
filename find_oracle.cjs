const oracledb = require('oracledb');

async function search() {
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: "OSPLUS",
      password: "SWXAQZ33",
      connectString: "10.12.50.11:1521/orcl.FRIGODIS.CP"
    });

    // We know EAN is something like '0025593208001975'
    // Let's search tables with columns like 'EAN', 'CODIGO_BARRA', etc.
    const searchVal = '0025593208001975';
    
    console.log("Checking CODBARRA table...");
    try {
      const q1 = await connection.execute(`SELECT * FROM CODBARRA WHERE ROWNUM <= 5`);
      console.log(q1.metaData.map(m => m.name));
      console.log(q1.rows);
    } catch(e) {}
    
    // Check if there is an ESTOQUE, CAIXA, or ETIQUETA table
    const tabs = await connection.execute(`SELECT table_name FROM user_tables WHERE table_name LIKE '%ETIQ%' OR table_name LIKE '%CAIXA%' OR table_name LIKE '%BALANCA%' OR table_name LIKE '%LOTE%'`);
    console.log("Possible tables:", tabs.rows);

  } catch (err) {
    console.error(err);
  } finally {
    if (connection) await connection.close();
  }
}

search();
