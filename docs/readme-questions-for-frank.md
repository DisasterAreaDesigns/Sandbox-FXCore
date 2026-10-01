# FXCore Simulator — Questions for Frank Thomson

Context: we've built a cycle-faithful FXCore simulator that runs assembled
programs in the browser, as part of the Sandbox FXCore web toolchain. It was
written entirely from the published documents — the FXCore Datasheet V1, the
FXCore Instruction Set V1.2 (September 2025) and application notes AN-1
through AN-8 — with no code taken from any other emulator.

Those documents got us almost the whole way: every instruction encoding, the
delay memory format, the LFO and ramp coefficient equations, the pot smoothing
filter, the tap tempo state machine and the FLAGS register are all specified
well enough to implement directly, and the results check out against the
assembler's own arithmetic. The list below is what's left.

Questions are grouped by how much they're holding us up. Section 1 is blocking
work. Section 2 is two places where we think the documents are wrong and would
like a sanity check. Section 3 is a set of yes/no confirmations where we've
already made a reasonable choice and just want to know if it matches silicon.

---

## 1. Assumptions we've had to make

We've moved forward on all three rather than leave the instructions unbuilt,
so these are now "please confirm or correct" rather than "we're stuck". The
simulator records `CHR` and `PITCH` as provisional whenever a program uses
them and tells the user the output isn't confirmed against hardware.

### 1.1 Is this the right model for `PITCH`, and what are XF0–XF3?

**What we've implemented:** two read pointers derived from the ramp value and
the block length, the second offset by half the block; each read linearly
interpolated between adjacent samples; the two crossfaded by a triangle; the
result summed and saturated — i.e. the FV-1 pitch transposer wrapped into a
single macro. The four crossfade shapes are all treated as linear for now.

This checks out behaviourally: using AN-2's own coefficients, +1 octave turns
a 200 Hz input into 400 Hz and −1 octave turns 400 Hz into 200 Hz, and a
parked ramp leaves the pitch untouched. But it's inference, not spec.

We have the encoding:

```
PITCH RAMP|LENGTH|XFADE, ADDRESS
1101 0010 00XX LL0R 0AAA AAAA AAAA AAAA
  X: crossfade shape    L: block length 512/1024/2048/4096
  R: ramp select        A: address of head of delay block
```

and AN-2 shows how to *drive* it, but neither the Instruction Set doc nor AN-2
says what the instruction computes. So:

- Is the half-block offset between the two pointers right?
- **What are the four crossfade shapes XF0, XF1, XF2, XF3?** These are defined
  nowhere we can find. Linear, raised cosine, equal power, something else — and
  in what order? This is the one part we can't even approximate, since we don't
  know what we're approximating.
- Is the result the sum of the two crossfaded taps, and does it saturate?

**Partly answered.** Frank: page 7 of the FV-1's AN-0001 shows the ramp and XF
relationship, the second XF — the one for ramp + 0.5 — is just 1 − XF, and
FXCore uses the same logic. So the two readers are complementary, which is what
the simulator already does: reader one is scaled by XF and reader two, half a
block behind it, by 1 − XF. Still open: which shape each of `XF0`–`XF3`
selects, and whether the four codes differ from one another at all. Until that
is settled the simulator keeps the FV-1's ramp relationship — 0 at the block
edge, 1 at the middle — for every code, and `PITCH` stays flagged provisional.

### 1.2 Does `CHR` interpolate its fractional address?

**What we've implemented:** linear interpolation between the two adjacent
samples, the same way the FV-1 does it and the same way `INTERP` is documented
to.

The address computation *is* documented, and the design rationale in the
datasheet is clear — the LFO is scaled to 0…1.0, multiplied by the depth in
`R15[30:16]`, and added to the head address, so narrowing the depth doesn't
introduce a delay offset the way a ±LFO about the block centre would.

What isn't stated is what happens to the fractional part of that product:

- Is the read linearly interpolated between the two adjacent samples, the way
  `INTERP` does?
- Or is the address truncated to an integer sample?
- If it does interpolate, is the coefficient the full fractional word, or
  truncated to some smaller number of bits?

This is audible on slow sweeps — truncation gives the characteristic stepping
— so we'd rather not guess.

### 1.3 Do internal INSCLK counts exist anywhere?

**Where we've landed:** as far as we can tell there is no published spec, so
the simulator has no core-utilisation readout at all.

The datasheet says programs have "approximately 3500 INSCLKs per sample period
at 48 kHz" and that instructions take one or more clocks, and the Instruction
Set doc says the assembler "will estimate how many clocks have been used and
warn the user when it exceeds 90%".

In practice we can't find that number anywhere. The current CLI assembler
(build 2025.3.0.0) prints:

```
Estimated core usage: NOT IMPLEMENTED YET
```

and the JavaScript port has a `prgclks` field that is initialised and never
written. So as far as we can tell no shipping tool reports core utilisation.

If internal per-instruction numbers exist, we'd like to implement them — both
in the simulator (a live utilisation meter) and in the web assembler, so it
warns at 90% the way the documentation describes. If they've never been
written down, we can measure them on hardware with probe programs of N
identical instructions and find where they overrun — happy to send you the
results if that's useful to you.

---

## 2. Two places we think the documents are wrong

Both of these produce a simulator that runs but is subtly incorrect, and we
only caught them because a test disagreed. Flagging them as likely errata.

### 2.1 Jump offsets look like they're relative to the *next* instruction

All six jump instructions are documented as:

```
If (condition) PC = PC + OFFSET
```

But every jump we've checked in a CLI assembler `.lst` resolves as
**`PC + 1 + OFFSET`** against the label table in the same file. From one
listing:

| Jump at PC | Encoded offset | Label resolves to | PC+OFFSET | PC+1+OFFSET |
| --- | --- | --- | --- | --- |
| 2 | 0x30 (48) | `DOPWM` = 51 | 50 | **51** |
| 56 | 2 | `DOPOT1` = 59 | 58 | **59** |
| 64 | 2 | `DOPOT2` = 67 | 66 | **67** |
| 112 | 2 | `DOLED` = 115 | 114 | **115** |

So the offset appears to be counted from the instruction *after* the jump,
which is the usual convention. Can you confirm? Taking the doc literally puts
every jump one instruction short.

### 2.2 The multipliers appear to shift the product left one bit

`MULTRR` is documented as:

```
ACC32 = (CREGX * CREGY)63:32
```

Taken literally, 0.5 × 0.5 in S.31 gives 0x40000000 × 0x40000000 = 2^60, whose
top 32 bits are 2^28 = 0.125 — half the right answer. We believe the result is
actually **bits 62:31**, i.e. the raw integer product shifted left one bit,
which is the normal signed-fractional multiply. Three things point that way:

1. The same page says −1.0 × −1.0 is the one case that saturates. Without the
   shift, that product's top word is 0x40000000 and needs no saturation at all;
   with the shift it's 2^31, which overflows S.31 exactly as documented.
2. The S.63 and S3.60 accumulator formats only line up with `SAT64`'s
   "shift left 3 bits" if the MAC instructions shift too.
3. With the shift, an all-pass built from `APA -g` / `APB +g` produces the
   textbook impulse response — immediate `g·x`, then `(1−g²)·x` at the delay
   length. Without it every coefficient comes out halved.

Is that right, and does the same one-bit shift apply to the whole `MAC*`
family as well as `MULTRR`/`MULTRI`?

---

## 3. Confirmations — we've made a choice, is it the right one?

These aren't blocking. In each case we've implemented something defensible and
would just like to know whether it matches the silicon.

**3.1 `ABS` of 0x80000000.** Documented as `ACC32 = |CREG|` with no saturation
note, but |−1.0| doesn't fit in S.31. We saturate to 0x7FFFFFFF, matching
`NEG`, which *is* documented to saturate. Correct?

**3.2 Delay memory writes.** `WRDEL` is documented as `[ADDRESS] = CREG31:16`.
We take that literally as truncation. Does the hardware truncate, or round to
nearest?

**3.3 `RAMPn_R` numeric range.** The datasheet gives `C = (f/Fs) × 2^32` for a
free-running ramp, which we've implemented as a 32-bit accumulator that simply
wraps — so the value read back sweeps the full signed range. Is `RAMPn_R`
intended to read as an unsigned 0…1 ramp instead, or as the signed wrapping
value we assumed?

**3.4 `NOISE`.** The datasheet describes it as using the thermal noise of the
part, which we read as genuinely random rather than a pseudo-random sequence.
That means no simulator can ever match hardware sample-for-sample on a program
that reads `NOISE`, so we use a fast PRNG and exclude such programs from
bit-exact comparison. Is that right, or is there a deterministic LFSR
underneath that we could match?

**3.5 `USR0` / `USR1`.** *Answered — the pins latch: they are not cleared at
the top of each program pass, and hold their state until another `SET` writes
them or the core resets.* The remaining half of the question stands: can a
running program read the current pin state back? The assembler carries these as
1-bit, header-only values (numbered 998/999 internally, packed into one byte of
the SFR header), and the Instruction Set doc's SFR table doesn't list them at
all, so we treat them as the initial state at program load with
`SET USERBIT|N, CREG` as the only way to drive them at runtime.

**3.6 Overflow flags.** Set when a channel is within 0.5 dB of full scale, per
the datasheet. Do the `INxOFLO`/`OUTxOFLO` bits reflect the current sample, or
are they latched and held for `OFLRLD` samples the way the OFLO LED is? We
currently update them every sample from the previous pass's outputs.

**3.7 Tap tempo, two details.** (a) When the user holds past `TAPSTKRLD` on the
*first* tap and then releases, we reset the unit so the next press starts a new
tap pair — is the reset on release, or immediately at the sticky threshold?
(b) Does `TAPTEMPO` retain its last measured value after a `MAXTEMPO` timeout,
or is it cleared?

---

## What we're not asking about

For completeness, so you know how far the documents did get us — all of the
following are implemented and tested purely from the published material, and
we believe they're right:

- every instruction encoding, including the 7-bit I field at 31:25 with bit 24
  reserved, and the R/M field layout for the extended operations;
- the 32K × 16-bit delay store, the S.15 truncation on every read and write,
  the AGU down-counter and the `RDDIRX`/`WRDIRX` bypass;
- the S.63 and S3.60 accumulator formats, the 3-bit headroom shift in the
  `MACH*` family, and `SAT64`;
- the all-pass pairs including R15/PARAM0 carrying the tail, and `INTERP`;
- `C = (2^31−1) × 2πF/Fs` for the LFOs — inverting it recovers the exact
  frequencies a program's `.equ` statements asked for;
- the pot smoothing filter `POTX_SMTH = ((POTX − POTX_SMTH) >> POTX_K) +
  POTX_SMTH`, and the ~2 kHz ADC scan rate;
- switch debounce with the one-sample `SWxPE`/`SWxRE` edge bits, `FLAGS`,
  `BOOTSTAT` and `SAMPLECNT`.

Thanks — and thanks for the documentation, which is a good deal better than
most parts of this kind ever get.
