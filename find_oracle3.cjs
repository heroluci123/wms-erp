const oracledb = require('oracledb');

async function searchExact() {
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: "OSPLUS",
      password: "SWXAQZ33",
      connectString: "10.12.50.11:1521/orcl.FRIGODIS.CP"
    });

    const val = '0025593208001975';
    console.log("Checking CONTLOTE_ETQ for", val);
    const q1 = await connection.execute(`SELECT PRO_CODIGO, PESO_LIQ, VENCIMENTO, SERIE_ETQ, CODIGO_ETIQUETA, TEXTO_ETIQUETA FROM CONTLOTE_ETQ WHERE CODIGO_ETIQUETA = :val OR SERIE_ETQ = :val`, { val: val });
    console.log("Rows:", q1.rows);

  } catch (err) {
    console.error(err);
  } finally {
    if (connection) await connection.close();
  }
}

searchExact();
