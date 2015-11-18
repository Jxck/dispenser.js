"use strict";

function base64url_encode(buf) {
  const TOKENS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  let str = "";
  let i = 0;
  for (; i+2 <= buf.length-1; i+=3) {
    // concat 3 byte (4 token for base64)
    let quad = buf[i] << 16 | buf[i+1] << 8 | buf[i+2];
    // change each 6bit from top to char
    str += TOKENS[(quad >> 18)];
    str += TOKENS[(quad >> 12) & 63];
    str += TOKENS[(quad >>  6) & 63];
    str += TOKENS[quad & 63];
  }

  if (i <= buf.length - 1) { // len is 2 or 1
    let quad = buf[i] << 16;
    str += TOKENS[quad >> 18]; // first 6bit
    i++;

    if (i <= buf.length - 1) {
      quad |= buf[i] << 8;
      str += TOKENS[(quad >> 12) & 63];
      str += TOKENS[(quad >>  6) & 63];
    } else {
      str += TOKENS[(quad >> 12) & 63];
    }
  }

  return str;
}

function test() {
  let buf = new Uint8Array(4);
  buf[0] = 0x41; // 0100,0001 0x41 65
  buf[1] = 0xcf; // 1100,1111 0xCF 207
  buf[2] = 0x89; // 1000,1001 0x89 137
  buf[3] = 0xff; // 1111,1111 0xFF 255

  let base64 = base64url_encode(buf);
  console.assert(base64 === "Qc-J_w");
  // console.log(`"${buf.join(" ")}" = "${base64}"`);
}


console.time('bench')
for (let i=0; i<10000; i++) {
  test(); // 12ms
}
console.timeEnd('bench');
