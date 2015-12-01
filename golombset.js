'use strict';

function Golombset(bufsize) {
  if (bufsize === undefined) bufsize = 1024;
  this.buf = new Uint8Array(bufsize);
  this.current = 0;
  this.shift = 8;
}


Golombset.prototype.encodeBit = function(bit) {
  // fill 1 in next octet
  if (this.shift === 0) {
    this.current += 1;
    this.buf[this.current] = 0xff;
    this.shift = 8;
  }

  this.shift -= 1;

  if (!bit) {
    // reverse target bit to 0
    this.buf[this.current] &= ~(1 << this.shift);
  }
};

Golombset.prototype.encodeValue = function(value) {
  // emit the unary bits
  let unary = value >> this.fixedBits; // value / p
  for (; unary > 0; unary--) { // N Unary
    this.encodeBit(1);         // 0 0
  }                            // 1 10
  this.encodeBit(0);           // 2 110

  // emit the rest
  // N = 151
  // 1001,0111
  // 0001,0111
  let shift = this.fixedBits;
  do {
    // emit each bit from top
    this.encodeBit((value >> --shift) & 1);
  } while (shift > 0);
};

Golombset.prototype.encode = function(keys) {
  let next_min = 0;

  this.fixedBits = Golombset.calcFixedBits(keys[keys.length - 1], keys.length);

  this.buf[0] = 0xff;

  // encode fixedBits as 5 bit value
  const GOLOMBSET_FIXED_BITS_LENGTH = 5;
  for (let i = 0; i !== GOLOMBSET_FIXED_BITS_LENGTH; ++i) {
    let bit = (this.fixedBits >> (GOLOMBSET_FIXED_BITS_LENGTH - 1 - i)) & 1;
    this.encodeBit(bit);
  }

  // encode each value
  for (let i = 0; i < keys.length; i++) {
    this.encodeValue(keys[i] - next_min);
    next_min = keys[i] + 1;
  }

  // after encode, shift = 8 means empty octet
  if (this.shift === 8) {
    this.current -= 1;
  }

  // cut out the filled buffer
  this.buf = this.buf.subarray(0, this.current + 1);
};

Golombset.calcFixedBits = function(maxKey, numKey) {
  // calculate P of [0, N*P)
  let P = Math.floor(maxKey / numKey);

  if (P < 1) return 0;

  // counting bit(log2(P))
  let bits = 0;
  while (P > 0) {
    bits++;
    P = P >> 1;
  }

  return bits - 1;
};


function test() {
  let bits = Golombset.calcFixedBits(1630, 26);
  console.assert(bits, 5);

  let bufsize = 256;
  let golombset = new Golombset(bufsize);

  let keys = [
    151, 192, 208, 269, 461, 512, 526, 591, 662, 806, 831, 866, 890, 997,
    1005, 1017, 1134, 1207, 1231, 1327, 1378, 1393, 1418, 1525, 1627, 1630,
  ];
  // let keys = [115, 923];
  console.log(keys.length);

  golombset.encode(keys);

  console.log(golombset.buf.join(' '));

  let expected = [
    47, 175, 32, 251, 159, 126, 145, 184, 24, 222, 123, 16, 151, 229, 14,
    95, 83, 33, 125, 250, 71, 49, 202, 226, 133,
  ];

  console.assert(golombset.buf.length === expected.length);
  for (let i = 0; i < expected.length; i++) {
    console.assert(golombset.buf[i] === expected[i]);
  }
}

// test();
