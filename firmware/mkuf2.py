#!/usr/bin/env python3
"""Wrap a raw RP2040 flash image as a UF2, and unwrap one back."""
import struct, sys

UF2_MAGIC0, UF2_MAGIC1, UF2_MAGIC_END = 0x0A324655, 0x9E5D5157, 0x0AB16F30
FAMILY_RP2040 = 0xE48BFF56
FLAG_FAMILY = 0x00002000

def wrap(binpath, uf2path, base=0x10000000):
    data = open(binpath, 'rb').read()
    assert len(data) % 256 == 0, "image must be a whole number of 256-byte pages"
    n = len(data) // 256
    out = bytearray()
    for i in range(n):
        out += struct.pack('<8I', UF2_MAGIC0, UF2_MAGIC1, FLAG_FAMILY,
                           base + i * 256, 256, i, n, FAMILY_RP2040)
        out += data[i*256:(i+1)*256]
        out += b'\x00' * (476 - 256)
        out += struct.pack('<I', UF2_MAGIC_END)
    open(uf2path, 'wb').write(out)
    return len(out), n

def unwrap(uf2path, binpath):
    d = open(uf2path, 'rb').read()
    out = bytearray()
    for i in range(len(d)//512):
        b = d[i*512:(i+1)*512]
        m0, m1, fl, addr, plen, bno, nb, fam = struct.unpack('<8I', b[:32])
        assert m0 == UF2_MAGIC0 and m1 == UF2_MAGIC1, f"bad magic in block {i}"
        assert struct.unpack('<I', b[508:512])[0] == UF2_MAGIC_END, f"bad end magic {i}"
        out += b[32:32+plen]
    open(binpath, 'wb').write(out)
    return len(out)

if __name__ == '__main__':
    if sys.argv[1] == 'wrap':
        size, n = wrap(sys.argv[2], sys.argv[3])
        print(f"wrote {sys.argv[3]}: {size} bytes, {n} blocks")
    else:
        print("unwrapped", unwrap(sys.argv[2], sys.argv[3]), "bytes")
