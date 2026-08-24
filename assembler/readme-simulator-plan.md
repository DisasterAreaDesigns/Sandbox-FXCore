# FXCore Simulator — Implementation Plan

Port of the Sandbox-FV1 in-browser simulator (`fv1-emu.js` + `fv1-sim.js`) to FXCore.

Specified against:

- **FXCore Datasheet** V1 (2020) — `FXCore_DS_V1.pdf`
- **FXCore Instruction Set** V1.2, September 2025 — `FXCore_Instruction_Set_2025.pdf`
- **FXCore Assembler** V1 — `FXCore_asm_V1.pdf`
- **Application notes AN-1 … AN-8** — `experimentalnoize.com/manuals/FXCore/app_notes/an-N.pdf`
  (INTERP, PITCH, LFOs, Tap Tempo, Phaser, Tap→LFO, Filter/POT cheat sheet, All-Pass)

Between the datasheet and the 2025 instruction set document, every instruction
is specified to the bit and nearly every peripheral has a stated equation.
This is a far better documentation position than the FV-1 port started from.
The residual unknowns are listed in §11 and are down to three.

Target files:

| File | Role |
| --- | --- |
| `assembler/fxcore-emu.js` | `FXCoreCore` — self-contained DSP core, no external references |
| `assembler/fxcore-sim.js` | Web Audio front end, worklet builder, UI glue |
| `assembler/index.html` | `SIM` flyout toggle + `#simPanel`, script tags |
| `assembler/styles.css` | `sim-*` rules |
| `assembler/ui.js`, `assembler/program.js` | expose assembled artifacts to the sim |
| `assembler/sim-test/` | headless Node harness + per-instruction tests |

The FV-1 pair is the template for structure, not for scale. Three things break
a direct port: throughput, the 64-bit accumulator, and the fact that an FXCore
program is not one flat image.

---

## 1. What does not carry over from the FV-1 simulator

### 1.1 Throughput

FV-1: 128 instructions × 32768 Hz = **4.2 M instructions/s**. A `switch`
dispatch interpreter in an AudioWorklet handles that with room to spare.

FXCore: the instruction RAM holds 1024 instructions, but the real limit is
clocks, not instructions — the datasheet states **~3500 INSCLKs per sample
period at 48 kHz**, with more available at lower rates, and instructions cost
one or more clocks each. Worst case is therefore on the order of
**1024 × 48000 ≈ 49 M instructions/s**, about 12× the FV-1 budget, before any
of the compound instructions (`APA`, `CHR`, `PITCH`, `INTERP`) that each do
several memory accesses and a multiply.

**Measured before deciding, and the answer changed the plan.** The reference
switch interpreter benchmarks at **~62 M instructions/s** (`sim-test/bench.js`,
Node 20 / V8, a mix of register maths, a fractional multiply, a 64-bit MAC and
delay read/write):

| Program length | x realtime at 48 kHz |
| --- | --- |
| 64 instructions | 18.4x |
| 128 | 9.8x |
| 256 | 5.0x |
| 512 | 2.5x |
| 1024 (worst case) | 1.3x |

So the switch interpreter alone holds real time even at the theoretical
maximum, and has 5-18x headroom over the length most published programs
actually are. The original assumption in this plan — that 49 M instructions/s
was out of reach for a switch interpreter and a compiler was mandatory — was
simply wrong.

**Revised decision: ship the interpreter, treat the JIT as an optimisation.**
Build the audio front end straight on the interpreter. Revisit compilation
only if a real program is measured to fall short; 1.3x on a shared browser
audio thread is thin, so full-length programs may still want it eventually.
If it is built, the shape is unchanged: decode once into typed arrays, emit a
JS function body and instantiate it with `new Function`, straight-line with a
`switch (pc)` re-entry only at jump targets — and since **all FXCore jumps are
forward-only** the control-flow graph is a DAG, which makes that materially
simpler than a general JIT.

Consequences of that measurement:

- The **`new Function` in `AudioWorkletGlobalScope`** question no longer gates
  anything. It only matters if the JIT is ever built, so probe it then.
- The interpreter is the reference implementation and the oracle regardless.
- An **offline render mode** (`OfflineAudioContext`, render N seconds, play the
  buffer) is still worth shipping, not as a performance fallback but because
  it is the natural way to produce a file for A/B against a hardware capture.

### 1.2 The 64-bit accumulator

`ACC64` is a real 64-bit accumulator with two documented formats:

- **S.63** — `MACRR`, `MACRI`, `MACRD`, `MACID`: S.31 × S.31 → S.63.
- **S3.60** — `MACHRR`, `MACHRI`, `MACHRD`, `MACHID`: the multiplicand is
  arithmetically shifted right 3 first, giving 3 bits of headroom so
  intermediate values can reach ±8.0 before clipping.

All eight saturate to `0x7FFFFFFFFFFFFFFF` / `0x8000000000000000`.
`SAT64 CREGNA` is `ACC64[63:32] << 3`, saturated into S.31 — the standard way
back out of the S3.60 form.

A 32×32 product reaches 2^62, so JS doubles (exact to 2^53) cannot hold it and
the FV-1 trick — "the product fits in a double, so integer-exact arithmetic is
free" — does not survive the port.

**Do not use BigInt in the sample loop.** At tens of millions of instructions
per second the allocation alone will sink it.

**Use a split hi/lo representation:** `acc64hi` / `acc64lo` as two 32-bit ints,
32×32 decomposed into 16-bit halves via `Math.imul`, carries propagated by
hand. Exact and allocation-free. Write `mac64`, `mach64`, `sat64`, `rd64u`,
`rd64l`, `ld64u`, `ld64l` as a helper set and unit-test them against BigInt
reference values — BigInt is fine as a *test oracle*, just not in the loop.

Two behaviours to get right because they are easy to miss:

- `ACC64` is **not cleared on program change** (instruction set doc, Reserved
  Words). `ACC32` is. `CLRACC64` is the only reset.
- `MULTRR`/`MULTRI` do **not** touch `ACC64` — they are the *other* multiplier,
  32×32 taking the top 32 bits into `ACC32`, saturating only the −1.0 × −1.0
  case to `0x7FFFFFFF`.

### 1.3 A program is not one image

The FV-1 simulator takes the 512-byte EEPROM image and that is the entire
program state. An assembled FXCore program is four separate blobs, laid out in
the Intel HEX at fixed addresses by `Program.Write_hex_file()` (`program.js`):

| HEX address | Section | Contents |
| --- | --- | --- |
| 0 | MREG | 128 × 32-bit presets (`.mreg`) |
| 2048 | CREG | settable core register presets (`.creg`), **only the settable ones**, packed |
| 4096 | SFR | pot K values packed 5-bit, LFO/ramp presets, tap tempo config |
| 6144 | PRG | 32-bit instruction words |

Each section carries a 2-byte checksum. The CREG section is *not* index-aligned
— `buildcreg()` (`fxcore_ic.js:277`) skips non-settable registers and packs the
rest, so reconstructing which register a slot belongs to means replaying
`issetable()`.

The SFR section is a fixed 48 bytes + 2 checksum, and `buildsfr()`
(`fxcore_ic.js:316`) pins its layout down completely:

| Bytes | Contents |
| --- | --- |
| 0–3 | `POT0_K`…`POT5_K`, six 5-bit fields packed LSB-first |
| 4–19 | `LFO0_F`…`LFO3_F`, 32-bit each |
| 20–27 | `RAMP0_F`, `RAMP1_F` |
| 28–31 | `MAXTEMPO` |
| 32–35 | `TAPTEMPO` |
| 36–37 / 38–39 | `TAPSTKRLD` / `TAPDBRLD`, 16-bit |
| 40–41 / 42–43 | `SWDBRLD` / `PRGDBRLD`, 16-bit |
| 44–45 | `OFLRLD`, 16-bit |
| 46 | bit 0 = `USR0`, bit 1 = `USR1` |
| 47 | 0x00 |
| 48–49 | checksum |

The assembler's defaults for anything not given a `.sreg` are visible in any
`.lst` and the sim must start from the same values: `POTn_K` = 10,
`MAXTEMPO` = 32767, `TAPSTKRLD` = 36000, `TAPDBRLD` = 480, `SWDBRLD` = 480,
`PRGDBRLD` = 2400, `OFLRLD` = 960, everything else 0.

**Decision: feed the simulator the assembler's objects, not the HEX.** Parsing
the HEX back is a lossy round trip through a packing designed for the I2C
protocol, and it discards the symbol table (`.rn` names, `.equ` values, line
numbers) that the debugging story in §7 depends on.

In `Program.Asm_it()` (`program.js:39`), stash the two locals currently thrown
away:

```js
FXCoreAssembler.lastAsm   = myasm;    // .program[] with .machine, .linenum, .mnemonic
FXCoreAssembler.lastTable = mytable;  // .checkreg — creg/mreg/sfr presets
```

Note that in the FXCore UI, `assembledData` (`ui.js:359`) is the HEX **string**,
not bytes — do not copy the FV-1 sim's `simLoadProgram()` shape without
changing this.

### 1.4 I/O width

FV-1: 2 in, 2 out, 3 pots. FXCore: `IN0`–`IN3` and `OUT0`–`OUT3` over two I2S
interfaces, `POT0`–`POT5`, 5 switches, an ENABLE/bypass input, a tap tempo
button, and two USER output pins for LEDs. Web Audio gives you stereo, so the
panel has to let the user pick which `OUTn` pair is monitored — and the extra
peripherals need on-screen controls, which is where this simulator becomes more
useful than the FV-1 one, because the Sandbox pedal's LEDs, footswitches and
tap button all become clickable.

---

## 2. Instruction set

### 2.1 Encoding

Confirmed from the instruction set doc, and it differs slightly from what the
assembler's field names suggest:

```
31:25   I field, 7-bit instruction
24      reserved, always 0
23:16   R field, generally a core register
15:0    M field, address / second register / shift count / 16-bit coefficient
```

`assembler.js:809` does `instruction.machine << 24` with an 8-bit `instbase`.
Every `instbase` in `mnemonic.js` is even, so this is exactly `opcode << 25`
with bit 24 clear. The two descriptions agree; **there is no hidden flag in
bit 0** — that open question from the first draft is closed.

Core register encoding is 5 bits: `R0`–`R15` = 0–15, `ACC32` = 16, `FLAGS` = 17
(read only, 16-bit, LSB aligned). `R15` doubles as **PARAM0**, the extra
parameter register for instructions that need more than the instruction word
can hold — `APA`/`APB`/`APRA`/`APRB`/`APRRA`/`APRRB`/`APMA`/`APMB` use it to
carry the all-pass tail between the pair, and `CHR` reads the chorus depth
from it. Any simulator that clobbers R15 in the wrong place will produce
plausible-sounding but wrong all-passes, so treat PARAM0 as explicit state.

Delay addresses are **15 bits** in the M field (`0AAA AAAA AAAA AAAA`), giving
the full 0–32767 range. Jump offsets are **12 bits, forward only**.

### 2.2 Opcode table

`instbase` values, parameter types in R/M order, extracted from `mnemonic.js`
and cross-checked against the instruction set doc:

| Op | Mnemonic | Params | Op | Mnemonic | Params |
| --- | --- | --- | --- | --- | --- |
| 0x00 | ABS | creg | 0x82 | RDACC64L | creg |
| 0x02 | CLRACC64 | — | 0x84 | LDACC64U | creg |
| 0x04 | ADDI | creg, imm16 | 0x86 | LDACC64L | creg |
| 0x06 | ADD | creg, creg | 0x88 | RDDEL | creg, addr |
| 0x08 | ADDS | creg, creg | 0x8A | WRDEL | addr, creg |
| 0x0A | ADDSI | creg, imm16d | 0x8C | RDDELX | creg, creg |
| 0x0C | SUB | creg, creg | 0x8E | WRDELX | creg, creg |
| 0x0E | SUBS | creg, creg | 0x90 | RDDIRX | creg, creg |
| 0x10 | SL | creg, imm5 | 0x92 | WRDIRX | creg, creg |
| 0x12 | SLR | creg, creg | 0x94 | SAT64 | creg |
| 0x14 | SLS | creg, imm5 | 0x96 | WRDLD | creg, imm16 |
| 0x16 | SLSR | creg, creg | 0xA0 | INV | creg |
| 0x18 | SR | creg, imm5 | 0xA2 | OR | creg, creg |
| 0x1A | SRR | creg, creg | 0xA4 | ORI | creg, imm16 |
| 0x1C | SRA | creg, imm5 | 0xA6 | AND | creg, creg |
| 0x1E | SRAR | creg, creg | 0xA8 | ANDI | creg, imm16 |
| 0x20 | MACRR | creg, creg | 0xAA | XOR | creg, creg |
| 0x22 | MACRI | creg, imm16d | 0xAC | XORI | creg, imm16 |
| 0x24 | MACRD | creg, addr | 0xAE | JGEZ | creg, addroffset |
| 0x26 | MACID | imm8d, addr | 0xB0 | JNEG | creg, addroffset |
| 0x28 | MACHRR | creg, creg | 0xB2 | JNZ | creg, addroffset |
| 0x2A | MACHRI | creg, imm16d | 0xB4 | JZ | creg, addroffset |
| 0x2C | MACHRD | creg, addr | 0xB6 | JZC | creg, addroffset |
| 0x2E | MACHID | imm8d, addr | 0xB8 | JMP | addroffset |
| 0x30 | MULTRR | creg, creg | 0xC0 | APA | imm8d, addr |
| 0x32 | MULTRI | creg, imm16d | 0xC2 | APB | imm8d, addr |
| 0x34 | NEG | creg | 0xC4 | APRA | creg, addr |
| 0x36 | LOG2 | creg | 0xC6 | APRB | creg, addr |
| 0x38 | EXP2 | creg | 0xC8 | APRRA | creg, creg |
| 0x60 | CPY_CC | creg, creg | 0xCA | APRRB | creg, creg |
| 0x62 | CPY_CM | creg, mreg | 0xCC | APMA | creg, mreg |
| 0x64 | CPY_CS | creg, sfr | 0xCE | APMB | creg, mreg |
| 0x66 | CPY_MC | mreg, creg | 0xD0 | CHR | imm4, addr |
| 0x68 | CPY_SC | sfr, creg | 0xD2 | PITCH | imm6, addr |
| 0x6A | CPY_CMX | creg, creg | 0xD4 | SET | imm6, creg |
| 0x80 | RDACC64U | creg | 0xD6 | INTERP | creg, addr |

`JZ` = 0xB4 and `JZC` = 0xB6 are **confirmed correct**. `mnemonic.js` registers
`JZC` twice — once at 0xB4 under a `// was "JZC"` comment, then again at 0xB6 —
and since the second `set()` overwrites the first in the Map, the net table is
right. It is vestigial dead code, not a bug.

### 2.3 Semantics worth writing down now

Everything below is from the instruction set doc and settles behaviour that
would otherwise have to be guessed.

**Delay memory is 16-bit, and that matters.** The RAM is 32K × **16-bit**,
storing S.15. Writes take the top half of the register (`WRDEL`:
`[ADDRESS] = CREG[31:16]`); reads zero-append back to S.31 (`RDDEL`:
`CREGNA = {[ADDRESS], 0x0000}`). So every trip through delay memory is a
**16-bit truncation** — this is FXCore's delay-line noise floor and the direct
analogue of the FV-1's companded 14-bit word. It is not optional to model.
It also means `RDDEL` of a value just written is not the value written.

**Address counter.** A counter decrements by 1 each sample period and is added
to the address in the instruction, making the memory a circular buffer where
you write low and read high. `RDDIRX`/`WRDIRX` (`@@REG` notation) bypass the
counter for absolute addressing; `RDDELX`/`WRDELX` (`@REG`) use `CREG[14:0]`
as the address *with* the counter added.

**Fixed-point formats.** `ADDSI` takes S.15 MSB-aligned. `MACRI`/`MULTRI` take
S.15 zero-padded to 32. `MACID`/`MACHID` take S.7 zero-padded. `LOG2` returns
**S5.26** (sign, 5 integer bits, 26 fractional); `EXP2` requires its input in
S5.26 **and documents that the sign bit must be 1** — i.e. `EXP2` is specified
only for negative inputs.

**All-pass pairs.** `APA S.7, ADDR` → `ACC32 = [ADDR]*S.7 + ACC32` and
`R15 = [ADDR]`; `APB S.7, ADDR` → `[ADDR] = ACC32` then
`ACC32 = ACC32*S.7 + R15`. The coefficients in the pair must be 2's complements
of each other. The `APR*` forms take the coefficient from a register and negate
it internally on the A instruction; `APRR*` take both coefficient and address
from registers; `APM*` use an MREG as a single delay element (the phaser case).

**`CHR LFO|W|N, ADDRESS`** — encoding `1101 0000 0000 NLLW 0AAA…`, where LL
selects the LFO, W picks SIN or COS, N negates. `R15[30:16]` must hold the
chorus depth in samples and `R15[31]` must be 0. The datasheet explains the
design choice: the LFO is scaled to 0…1.0 and multiplied by the depth, then
added to the *head* address, so narrowing the depth does not introduce a
delay offset the way a ±LFO about the centre of the block would.

**`INTERP CREG, ADDRESS`** is fully specified:
`ACC32 = ([@CREG[30:16] + ADDR + 1] − [@CREG[30:16] + ADDR]) * (CREG[15:0] << 15) + [@CREG[30:16] + ADDR]`
with `CREG[15:0]` treated as unsigned fractional with a 0 sign bit prepended.

**`SET USERBIT|N, CREG`** writes bit N of CREG to the USER0 or USER1 pin. This
is the **only** documented path to the LED outputs — see §4.

**`.MEM name len`** allocates `len + 1` words and generates three symbols:
`name` (head / write pointer), `name#` (tail / read pointer), `name!` (length).

---

## 3. Machine state

```
CREG   R0..R15 (R15 = PARAM0), ACC32 (16), FLAGS (17, R/O, 16-bit)  Int32Array(18)
ACC64  S.63 or S3.60, split hi/lo, NOT cleared on program change    two int32
MREG   MR0..MR127, also a lookup table via CPY_CMX (CREG[6:0])      Int32Array(128)
SFR    see §4                                                        Int32Array(49) + accessors
DELAY  32768 × 16-bit words, S.15                                    Int16Array(32768)
AGU    address counter, decremented once per sample period           int32
```

On program change: instruction RAM reloaded, **outputs muted**, **delay RAM
cleared**, CREG/MREG/SFR presets loaded from the header, `ACC32` cleared,
`SAMPLECNT` reset — but `ACC64` left alone. The sim's `reset()` should do
exactly this list, and the panel's Panic button should call it.

`FLAGS` (16-bit, LSB aligned, read only):

| Bit | Name | Meaning |
| --- | --- | --- |
| 15–12 | OUT3/2/1/0 OFLO | output overflow |
| 11–8 | IN3/2/1/0 OFLO | input clip |
| 7–6 | — | reserved |
| 5 | TB2nTB1 | 0 = first tap event, 1 = second tap event |
| 4 | TAPSTKY | tap held longer than `TAPSTKRLD` |
| 3 | NEWTT | new value in `TAPTEMPO`, 1 sample period |
| 2 | TAPRE | tap release edge |
| 1 | TAPPE | tap push edge |
| 0 | TAPDB | debounced tap level, **0 if pressed**, 1 if not |

Overflow bits set when a channel is **within 0.5 dB of full scale**, and are
valid for as long as the condition holds; edge flags last exactly one sample.

Two naming points, both now resolved:

- **`TAPDB` is the correct name for FLAGS bit 0.** Both PDFs call it that; the
  instruction set doc's reserved-word table omits it entirely and
  `reserved_words.js` only had `TAPLVL`. `TAPDB` has been added as a reserved
  word (0x0001) with `TAPLVL` retained as a deprecated alias so existing
  sources keep assembling, and both are in the Monaco constant highlighting.
- **`USR0`/`USR1` are real and are the LED registers**, but they are *boot
  presets*, not runtime SFRs — see §4.

Dead code found while specifying this, worth deleting or fixing rather than
trusting:

- `common.maxaddro` = 16535 with a comment saying "14 bits max". The real field
  is 15 bits (0–32767) and **the constant is referenced nowhere** in the JS.
- `Assembler.prgclks` / `prgcore` are initialised to 0 in `assembler.js:19-20`
  and never written. Neither assembler computes INSCLK utilisation — the CLI
  tool (build 2025.3.0.0) prints `Estimated core usage: NOT IMPLEMENTED YET`
  in the `.lst`. So the per-instruction clock table exists in **no** tool
  today, and the cycle-budget readout in §5 is blocked on §11.3.

---

## 4. Peripherals

All of these update once per sample period and — the doc is explicit about this
for pots, LFOs, ramps, `PIN` and `SWITCH` — **hold the same value for the whole
duration of the program pass**. That is a simplifying property: sample them
once at the top of the pass, not per instruction.

**Pots.** Six 12-bit ADC inputs. `POTn` is the raw value, S.12 in the 13 MSBs.
`POTn_SMTH` is the smoothed value in S.31. The filter is exactly:

```
POTX_SMTH = ((POTX − POTX_SMTH) >> POTX_K) + POTX_SMTH     (each sample period)
```

with `POTn_K` a 5-bit shift count — larger K, slower settling. Note the pot
pins are **sampled at approximately 2 kHz**, not at the sample rate, so a
faithful model steps the raw value on a ~2 kHz grid and runs the filter at Fs.
`tap_lfo_takeover.fxc` compares `POT0_SMTH` against a stored value with a
threshold and is a good behavioural test.

**LFOs.** Four sine/cosine generators. Frequency coefficient:

```
C = (2^31 − 1) * (2*pi*F) / Fs
```

confirming the guess from `tap_lfo_takeover.fxc` — `LFOn_F` is the per-sample
phase increment in radians scaled to S.31. Outputs `LFOn_S` / `LFOn_C` are
32-bit, −1.0 to +1.0. Designed for 0–20 Hz; higher frequencies distort on
hardware, which the sim need not reproduce but should not accidentally
"improve" either.

**Ramps.** Two, for pitch shifting. As a plain ramp, `C = (f/Fs) * 2^32`. For
pitch, from AN-2: up is `C = −2^23 * (2^N − 1) * (512/L)`, down is
`C = 2^23 * (1 − 1/2^N) * (512/L)`, where L ∈ {512, 1024, 2048, 4096}. The sign
convention follows from the AGU's *down* counter: a down ramp reads faster and
pitches up. Outputs read from `RAMP0_R` / `RAMP1_R`.

**Tap tempo.** A full state machine, specified in the instruction set doc's
"Tap Tempo Operation" section and AN-4:

- `TAPTEMPO` = sample periods between two successive taps; `NEWTT` set for one
  sample when it updates.
- `MAXTEMPO` = timeout in samples; exceeding it resets to "waiting for first
  tap".
- `TAPSTKRLD` = hold length in samples before `TAPSTKY` sets; holding past it
  **on the first tap** resets the unit on release, which is the documented idiom
  for hold-to-toggle-mode. Holding on the *second* tap still updates
  `TAPTEMPO` and sets `NEWTT`, then sets `TAPSTKY` — the documented idiom for
  "tap it in, then hold to switch to triplets".
- `TAPDBRLD` = debounce in samples. Preset-only, like `SWDBRLD`, `PRGDBRLD`,
  `OFLRLD`.

**Switches.** `PIN` is the **raw input** SFR — bits 0–4 are SW0–SW4, bit 5 is
ENABLE, bit 6 is TAP, and pins are pulled up so an unconnected switch reads 1.
`SWITCH` is the debounced view: bits 0–4 levels, 5–9 release edges, 10–14 push
edges, bit 15 `ENABLEDB`. Edge bits are high for exactly one sample period.
Debounce time comes from `SWDBRLD`, which is preset-only and unreadable.

**USER0 / USER1 outputs (the LEDs).** There are two distinct write paths and
the simulator needs both:

- **Boot preset** — `.sreg usr0 1` / `.sreg usr1 1` sets the pin's initial
  state at program load. In `registers.js` these are numbered 998/999 (sentinel
  values, not SFR addresses), sized 1 bit, `rw = N`, and `buildsfr()` packs
  them into **byte 46 of the SFR header, bits 0 and 1** (`fxcore_ic.js:391`).
  They appear in the `.lst` SREG preset dump as `USR0()` / `USR1()`.
- **Runtime** — `SET USERBIT|N, CREG` writes bit N of a core register to the
  USER0 or USER1 pin. `USER0` = 0x00 and `USER1` = 0x20 are the U-bit position
  in the M field, e.g. `D4100020` decodes as `SET USER1|0, ACC32`.

So `USR0`/`USR1` are not readable or writable by program instructions — the
instruction set doc's SFR table is simply silent on them because they are
header-only. The Sandbox test programs `alternate-blink.fxc`,
`both-led-on.fxc` and `fade-test.fxc` exist purely to blink these, so
**virtual LEDs are a first-class UI element** — and they make Phase 1
demonstrable long before any audio works.

**`NOISE`.** The datasheet describes it as a random number generator using the
**thermal noise of the chip**. It is genuinely random, not an LFSR — so
bit-exact hardware matching is impossible for any program that reads it, and
the sim only needs a decent PRNG. This removes work rather than adding it, but
it also means `NOISE`-using programs are excluded from the bit-exact A/B suite
in §8.

**`SAMPLECNT`, `BOOTSTAT`.** `SAMPLECNT` is a free-running unsigned 32-bit
counter, reset on program change, rolls over. `BOOTSTAT` is latched at boot:
bits 0–9 are PLL range, master/slave and the I2C address straps, bits 16–31
report which of the 16 program slots are occupied. Both are cheap to model and
`BOOTSTAT` can be driven from the panel.

---

## 5. Front end (`fxcore-sim.js`)

Structurally a copy of `fv1-sim.js`. Keep these decisions, they were right:

- Build the worklet by `FXCoreCore.toString()` into a `blob:` URL so the
  simulator works from a `file://` page. This forces `FXCoreCore` to stay
  **strictly self-contained**. With a JIT that matters more, not less: the code
  generator and its tables live inside the class too.
- Publish the audio graph handles only after every node is built, so a partial
  failure cannot leave a half-constructed engine behind.
- Report the rate the browser actually gave versus the one requested.
- Hook the assemble function so the loop is edit → assemble → hear it.

Changes for FXCore:

- **Sample rate.** Offer the rates the hardware can actually run, not arbitrary
  ones. In master mode the PLL pins select 12 / 24 / 32 / 48 kHz from a
  12.288 MHz clock, or 11.025 / 22.05 / 29.4 / 44.1 kHz from 11.2896 MHz; in
  slave mode anything up to 96 kHz. Default 48 kHz — which is also the native
  rate of most browsers, a real improvement on the FV-1's 32768 Hz that
  browsers frequently refused. Max delay is `32768 / Fs` seconds (1.0 s at
  32 kHz, 0.68 s at 48 kHz); show it, as the FV-1 panel does.
- **Sources.** Reuse wholesale: tone/saw/square, noise, file, live input.
- **Output routing.** Selector for which `OUTn` pair feeds the monitor, meters
  on all four, and clip indicators driven from the real `FLAGS` overflow bits
  rather than a separate check.
- **Program load.** Send `{program[], cregPresets, mregPresets, sfrPresets}` to
  the worklet rather than a byte image.
- **Panel.** Follows the existing `toggleFlyout('sim')` / `#simPanel` pattern
  (`index.html:481-483`, `668-683`): transport, status, meters, 6 pot sliders
  with per-pot K, 5 switch toggles, ENABLE toggle, tap button, USER0/USER1 LED
  indicators, input/output trim, bypass, auto-reload, rate selector, and a
  cycle-count readout against the ~3500 INSCLK budget.

---

## 6. Fidelity checklist

The things that make an FXCore program sound like an FXCore program, in rough
order of audibility. Getting these wrong produces something that works but is
subtly not the chip:

1. **16-bit delay memory truncation** on every read and write (§2.3).
2. **Saturation behaviour** — which instructions saturate and which roll over.
   `ADD`/`ADDI`/`SUB` are modulo-2^32; `ADDS`/`ADDSI`/`SUBS` saturate. Mixing
   these up is silent on quiet material and violent on loud material.
3. **`ACC64` saturation** at the S.63 / S3.60 bounds, and the 3-bit headroom
   shift in the `MACH*` family.
4. **Pot smoothing** with the real shift-based filter and the ~2 kHz raw
   sampling grid.
5. **The address counter** decrementing once per sample, and the
   `RDDIRX`/`WRDIRX` bypass.
6. **`LOG2`/`EXP2`** in S5.26, including `EXP2`'s negative-input restriction.
7. **Edge flags** lasting exactly one sample period.

---

## 7. Stretch: a debugger

FXCore makes something the FV-1 simulator could not justify. The assembler
keeps `linenum` and `mnemonic` on every instruction and the symbol table holds
`.rn` aliases, so with the objects exposed per §1.3 you get, for little extra
work:

- single-step and run-to-breakpoint on the reference interpreter (not the JIT),
- a register inspector showing `.rn` names rather than `R7`,
- highlighting the current source line in Monaco,
- a per-instruction clock count and running total against the ~3500 budget —
  which the web assembler does not currently compute at all (§3).

Schedule it after the audio path works, but shape the interpreter's API for it
from the start: `step()` returning the next `pc`, state readable from outside.

---

## 8. Validation

1. **Per-instruction unit tests**, Node harness, no browser — `sim-test/`.
   `test-core.js` covers arithmetic, saturation, shifts, multiplies, logic,
   jumps, delay memory, copies, `SET`, pot smoothing, LFOs and an all-pass
   pair; `mul64s` is checked against BigInt over ~172k operand pairs and the
   accumulator over a 2000-MAC run including saturation. `test-shiftreg.js`
   runs a real 118-instruction program transcribed from a CLI `.lst`.
   `test-programs.js` assembles the repo's own `test_programs/` with the real
   assembler via `sim-test/assemble.js` and runs them. `run-all.js` runs the
   lot: 117 assertions at the time of writing.
2. **Interpreter vs JIT differential.** Run both over every test program and
   every example in `examples.js`, assert bit-identical register and delay
   state after N samples. Catches code-generation bugs cheaply and permanently.
3. **Hardware A/B** for the instructions the docs do not fully specify (§11).
   The repo already has the programming path (RP2040 + `FXCoreProgrammer.js`,
   or drop a `.hex` on the SANDBOX drive). Play a known WAV through the Sandbox
   pedal, capture the output, run the identical file through the simulator,
   compare. Exclude any program that reads `NOISE` from bit-exact comparison.
4. **The LED programs are the Phase 1 gate.** `alternate-blink.fxc` and
   `both-led-on.fxc` need no audio at all, so the core can be proven against
   visible hardware behaviour before the worklet exists.
5. **The CLI assembler's `.lst` is a free decoder oracle.** Its Code Listing
   gives `Line : PC : Binary : Source` with every operand resolved and
   annotated with its encoded value — e.g.
   `0037 : 0001 : A81000FF : ANDI ACC32(0x10), 0XFF(0x00FF)`. Assemble the test
   corpus with the CLI tool, parse the listing, and assert the simulator's
   decoder recovers the same mnemonic and operands from the same 32-bit word.
   That validates the entire decode path without writing a single expected
   value by hand. The Label table in the same file gives the jump targets to
   check forward-offset resolution against.
6. **The app notes are ready-made test vectors.** AN-2 ships a complete
   `an-2.fxc` pitch program, AN-5 a phaser, AN-6 a tap-to-LFO program, AN-8 a
   set of all-pass structures. Each is a small program exercising exactly one
   hard instruction, with the expected behaviour described in prose.

---

## 9. Licensing

Same discipline as `fv1-emu.js`, which carries an explicit note that ElmGen and
SpinCAD are GPL-3.0, that no code was taken from either, and exactly which two
undocumented behaviours were confirmed by consulting them. This repo is MIT and
the FXCore assembler source was shared by Frank Thomson directly, so:

- Work from the datasheet, the instruction set document and the application
  notes. Between them they specify almost everything (§11 is what remains).
- Where behaviour is undocumented, derive it from hardware capture and **record
  in the source comment how it was determined**. That is what makes the file
  defensible.
- The vendor PDFs are Experimental Noize copyright. Reference them by URL from
  the source header; **do not commit them to this MIT repo** without asking
  Frank first.
- Frank remains the authority on anything the docs do not cover. §11 is short
  enough now to be a single email.

---

## 10. Phasing

| Phase | Deliverable | Gate |
| --- | --- | --- |
| **0. Groundwork** — DONE | `lastAsm`/`lastTable` exposed plus `FXCoreAssembler.buildSimImage()` (`program.js`); `sim-test/assemble.js` runs the real browser assembler headlessly in a Node VM; `new Function` probe answered | — |
| **1. Core** — DONE | `fxcore-emu.js`: all Tier 1 + 64-bit instructions, registers, 16-bit delay memory, AGU counter, forward jumps, presets | `both-led-on.fxc` and `alternate-blink.fxc` drive USER0/1 correctly; 117 tests green |
| **2. Peripherals** — DONE, needs hardware A/B | Pots + smoothing + 2 kHz grid, LFOs, ramps, tap tempo state machine, switches with edges, `SET`, `NOISE`, `SAMPLECNT`, `FLAGS` | `tap_lfo_takeover.fxc` tracks the pot correctly including its 0.05 hysteresis |
| **3. Extended DSP** — DONE, two provisional | `AP*` family, `INTERP`, `LOG2`, `EXP2` from the docs. `CHR` and `PITCH` modelled on the FV-1 equivalents and flagged provisional at runtime | `PITCH` shifts 200 Hz to 400 Hz up and 400 to 200 down using AN-2's own coefficients; hardware A/B still wanted |
| **4. Audio** — DONE | `fxcore-sim.js`: worklet built from `FXCoreCore.toString()` via a blob URL, sources, 4-out metering with a monitor-pair selector, PLL rate selector, assemble hook | Verified in-browser: correct levels, live pots, blinking USER pins |
| **5. Performance** — mostly moot | Interpreter already holds real time (§1.1). Offline render mode for hardware A/B. JIT only if a real program is measured short | A real program measured below ~4x realtime |
| **6. UI** | `#simPanel`, `sim-*` styles, pots/switches/LEDs/tap/ENABLE, assemble hook | Edit → assemble → hear, no extra click |
| **7. Validate & document** | Hardware A/B suite, fidelity notes in the source header, readme section | — |

Phases 1 and 2 are now mostly transcription from §2 and §4 rather than
research. Phase 3 is the one with genuine unknowns.

---

## 10a. Corrections the build turned up

Two places where the documentation is loose enough to produce a working-but-
wrong emulator. Both were caught by tests, and both are worth knowing about
before reading the instruction set doc literally.

**Jump offsets are relative to the next instruction.** The doc says
`PC = PC + OFFSET` for all six jumps. Every jump in a CLI `.lst` resolves as
`PC + 1 + OFFSET` against the label table in the same file — e.g. the `JNZ` at
PC 2 with offset 0x30 targets `DOPWM` at PC 51, and four more jumps in the
same listing agree. Taking the doc literally puts every jump one instruction
short.

**Every multiplier is a fractional multiply, i.e. the raw integer product is
shifted left one bit.** The doc writes `MULTRR` as `ACC32 = (CREGX * CREGY)63:32`,
which taken literally makes 0.5 × 0.5 come out as 0.125. Three things say
otherwise and all agree on bits 62:31 rather than 63:32:

- the same page notes that −1.0 × −1.0 is the one case that saturates, which
  is only true with the shift (without it the raw top word is 0x40000000 and
  needs no saturation at all);
- the S.63 and S3.60 accumulator formats only line up with `SAT64`'s
  "shift left 3 bits" if the MACs shift too;
- with the shift, an all-pass built from `APA -g` / `APB +g` produces the
  textbook impulse response (immediate `g·x`, echo `(1-g²)·x` at the delay
  length), and without it every coefficient is halved.

This was found by the all-pass test, which is a good argument for writing the
behavioural tests early rather than only per-instruction ones.

**One documented gap, settled by decision rather than by the doc:** `ABS` is
given as `ACC32 = |CREG|` with no saturation note, but `|0x80000000|` does not
fit. The core saturates to `0x7FFFFFFF` — max positive, sign bit dropped —
matching `NEG`, which is documented to saturate. Agreed as the emulator's
behaviour; hardware has not been checked and the case is vanishingly rare in
real programs.

---

## 10b. In-browser verification

The front end was driven end to end in a Chromium browser against a local
http server, with these results:

- **`new Function` and `eval` both work inside `AudioWorkletGlobalScope`**
  (Chromium, worklet loaded from a `blob:` URL), and `BigInt` is available
  there too. The Phase 0 probe is answered; a future JIT is not blocked.
  Firefox and Safari still unchecked, but nothing depends on it now.
- **Levels are exact.** A `cpy_cs / multri 0.5 / cpy_sc out0` program with the
  input trim at −6 dB (0.501) meters OUT0 at 25.1% and OUT1 (unity through a
  4800-sample delay) at 50.1%.
- **Pots are linear end to end.** Sweeping POT0 through a `multrr` gain stage
  gives 0 / 12.5 / 25.1 / 37.6 / 50.1%.
- **`alternate-blink` blinks in the worklet**, USER0 and USER1 always
  complementary, ~180 ms per state against the 170.7 ms that 8192 samples at
  48 kHz predicts.
- **Rate switching rebuilds the engine correctly**: 12 / 24 / 32 / 48 kHz give
  2.731 / 1.365 / 1.024 / 0.683 s of maximum delay, and the 32 kHz figure
  matches the datasheet's "1 second of delay at 32 kHz" exactly.
- **A program using `CHR` says so** rather than producing plausible-sounding
  wrong audio.

The rate selector offers only the four master-mode PLL dividers — 12, 24, 32
and 48 kHz from a 12.288 MHz clock — since those are what the hardware can
actually produce.

---

## 11. Remaining open questions

The datasheet and instruction set doc closed most of the original list. What is
left:

**Two are now implemented on a working assumption rather than a spec.** The
decision was to model `CHR` and `PITCH` as the equivalent FV-1 structures
wrapped into single macros. Both execute, both are recorded in
`core.provisional` when they run, and the panel says so — the output sounds
right but is not confirmed against silicon.

1. **`PITCH`** — two read pointers derived from the ramp value and the block
   length, the second offset by half the block, each read with linear
   interpolation between adjacent samples, crossfaded by a triangle, result
   summed and saturated. The four crossfade shapes XF0–XF3 remain undocumented
   and are all treated as linear. This is validated behaviourally: with AN-2's
   own coefficients, +1 octave turns 200 Hz into 400 Hz and −1 octave turns
   400 Hz into 200 Hz, and a parked ramp leaves pitch untouched. Still worth a
   hardware A/B, and worth asking about the crossfade shapes.
2. **`CHR`** — the documented address arithmetic (LFO scaled 0…1.0 × the depth
   in `R15[30:16]`, added to the head address) with the fractional part
   linearly interpolated, as the FV-1 does. Address mapping is unit-tested
   against a marker pattern in delay memory.
3. **Per-instruction INSCLK counts.** There is no published spec, and no
   shipping tool computes them — the CLI assembler prints
   `Estimated core usage: NOT IMPLEMENTED YET` and the JS port's `prgclks` is
   dead code (§3). So the cycle-budget readout stays unbuilt unless Frank has
   internal numbers, or until they are measured on hardware: assemble probe
   programs of N identical instructions, raise N until the program overruns
   the sample period at a known rate, solve for clocks per instruction. If it
   is measured, the simulator would be the first tool to report core usage at
   all.

Everything else — delay word format, address counter, all fixed-point formats,
the all-pass pairs, `INTERP`, `SET`, LFO and ramp coefficients, pot smoothing,
tap tempo, switch debounce, `FLAGS`, `BOOTSTAT`, `NOISE` — is specified in the
documents cited at the top of this file.

---

## 12. TODO

Things known to be wrong or missing, not yet scheduled.

*(Nothing outstanding. The ENABLE/Bypass split that sat here is done: ENABLE is
now the single control for the ENABLE/nBypass pin. It sets `PIN` bit 5 and
`SWITCH` bit 15 as before, and the worklet swaps each input for the matching
output after the core has run, so the program keeps executing with its delay
tails, LFOs, tap tempo and USER pins intact and the monitor pair selector still
picks a real channel. The separate Bypass checkbox is gone from Levels.)*
