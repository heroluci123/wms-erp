import { createClient } from '@libsql/client';

async function check() {
  const url = 'https://wms-erp-heroluci123.aws-us-east-1.turso.io';
  const authToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg';
  
  const client = createClient({ url, authToken });

  try {
    const res = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
    console.log(res.rows);
  } catch (error) {
    console.error('Check failed:', error);
  }
}

check();
