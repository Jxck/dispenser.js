"use strict";

/*
 *  0  000000  A   16  010000  Q   32  100000  g   48  110000  w
 *  1  000001  B   17  010001  R   33  100001  h   49  110001  x
 *  2  000010  C   18  010010  S   34  100010  i   50  110010  y
 *  3  000011  D   19  010011  T   35  100011  j   51  110011  z
 *  4  000100  E   20  010100  U   36  100100  k   52  110100  0
 *  5  000101  F   21  010101  V   37  100101  l   53  110101  1
 *  6  000110  G   22  010110  W   38  100110  m   54  110110  2
 *  7  000111  H   23  010111  X   39  100111  n   55  110111  3
 *  8  001000  I   24  011000  Y   40  101000  o   56  111000  4
 *  9  001001  J   25  011001  Z   41  101001  p   57  111001  5
 * 10  001010  K   26  011010  a   42  101010  q   58  111010  6
 * 11  001011  L   27  011011  b   43  101011  r   59  111011  7
 * 12  001100  M   28  011100  c   44  101100  s   60  111100  8
 * 13  001101  N   29  011101  d   45  101101  t   61  111101  9
 * 14  001110  O   30  011110  e   46  101110  u   62  111110  -
 * 15  001111  P   31  011111  f   47  101111  v   63  111111  _
 */
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
  ((byte3) => {
    let buf = new Uint8Array([
       0x41 // 0100,0001 0x41 65
      ,0xcf // 1100,1111 0xCF 207
      ,0x89 // 1000,1001 0x89 137
    ]);

    let base64 = base64url_encode(buf);
    console.log(`"${buf.join(" ")}" = "${base64}"`);
    console.assert(base64 === "Qc-J");
  })();

  ((byte4) => {
    let buf = new Uint8Array([
       0x41 // 0100,0001 0x41 65
      ,0xcf // 1100,1111 0xCF 207
      ,0x89 // 1000,1001 0x89 137
      ,0xff // 1111,1111 0xFF 255
    ]);

    let base64 = base64url_encode(buf);
    console.log(`"${buf.join(" ")}" = "${base64}"`);
    console.assert(base64 === "Qc-J_w");
  })();

  ((byte5) => {
    let buf = new Uint8Array([
       0x41 // 0100,0001 0x41 65
      ,0xcf // 1100,1111 0xCF 207
      ,0x89 // 1000,1001 0x89 137
      ,0xff // 1111,1111 0xFF 255
      ,0x43 // 0100,0011 0x43 67
    ]);

    let base64 = base64url_encode(buf);
    console.log(`"${buf.join(" ")}" = "${base64}"`);
    console.assert(base64 === "Qc-J_0M");
  })();

  ((more) => {
    let buf = new Uint8Array([
       0x41 // 0100,0001 0x41 65
      ,0xcf // 1100,1111 0xCF 207
      ,0x89 // 1000,1001 0x89 137
      ,0xff // 1111,1111 0xFF 255
      ,0x43 // 0100,0011 0x43 67
      ,0x55 // 0101,0101 0x55 85
      ,0x0f // 0000,1111 0x0f 15
      ,0x7e // 0111,1110 0x7e 126
    ]);

    let base64 = base64url_encode(buf);
    console.log(`"${buf.join(" ")}" = "${base64}"`);
    console.assert(base64 === "Qc-J_0NVD34");
  })();
}

console.time('bench')
for (let i=0; i<10000; i++) {
  test(); // 526ms
}
console.timeEnd('bench');
