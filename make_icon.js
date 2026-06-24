const { Jimp } = require('jimp')
const fs = require('fs')
const path = require('path')

async function run() {
  const img = await Jimp.read('assets/icon.png')
  
  // Resize to 256x256 and save as PNG (real PNG this time)
  await img.resize({ w: 256, h: 256 }).write('assets/icon_256.png')
  console.log('PNG 256x256 created at assets/icon_256.png')
  
  // Create minimal ICO manually (single 256x256 image)
  // ICO header: ICONDIR
  const pngBuf = fs.readFileSync('assets/icon_256.png')
  
  // ICO file structure
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)  // Reserved
  header.writeUInt16LE(1, 2)  // Type: ICO
  header.writeUInt16LE(1, 4)  // Count: 1 image
  
  const dirEntry = Buffer.alloc(16)
  dirEntry.writeUInt8(0, 0)   // Width: 0 = 256
  dirEntry.writeUInt8(0, 1)   // Height: 0 = 256
  dirEntry.writeUInt8(0, 2)   // ColorCount
  dirEntry.writeUInt8(0, 3)   // Reserved
  dirEntry.writeUInt16LE(1, 4) // Planes
  dirEntry.writeUInt16LE(32, 6) // BitCount
  dirEntry.writeUInt32LE(pngBuf.length, 8)  // SizeInBytes
  dirEntry.writeUInt32LE(6 + 16, 12)        // ImageOffset
  
  const ico = Buffer.concat([header, dirEntry, pngBuf])
  fs.writeFileSync('assets/icon.ico', ico)
  console.log('ICO created at assets/icon.ico (' + ico.length + ' bytes)')
}

run().catch(e => console.error(e))
