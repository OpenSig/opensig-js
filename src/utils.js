// Copyright (c) 2023 Bubble Protocol
// Distributed under the MIT software license, see the accompanying
// file LICENSE or http://www.opensource.org/licenses/mit-license.php.

//
// General utility functions
//


export function readFile(file) {
  return new Promise( (resolve, reject) => {
    var reader = new FileReader();
    reader.onload = () => { resolve(reader.result) };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  })
}


export function buf2hex(buffer, prefix0x=true) {
  return (prefix0x ? '0x' : '')+[...new Uint8Array(buffer)]
      .map(x => x.toString(16).padStart(2, '0'))
      .join('');
}


export function hexToBuf(hex) {
  return Uint8Array.from(hex.replace('0x','').match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
}


export function concatBuffers(buffer1, buffer2) {
  var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
}


export function unicodeStrToHex(str) {
  var result = "";
  for (let i=0; i<str.length; i++) {
    const hex = str.charCodeAt(i).toString(16);
    result += ("000"+hex).slice(-4);
  }
  return result
}


export function unicodeHexToStr(str) {
  var hexChars = str.replace('0x','').match(/.{1,4}/g) || [];
  var result = "";
  for(let j = 0; j<hexChars.length; j++) {
    result += String.fromCharCode(parseInt(hexChars[j], 16));
  }
  return result;
}
