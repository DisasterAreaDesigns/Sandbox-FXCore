// Example programs for the user to try out

const examples = {
    fxcore_passthrough: `; FXCore Simple Pass-through
; Input -> Output with no processing

cpy_cs  acc32, in0      ; read input from left ADC
cpy_sc  out0, acc32     ; write accumulator to left DAC
cpy_cs  acc32, in1      ; read input from right ADC
cpy_sc  out1, acc32     ; and write accumulator to DAC`,

    fxcore_blink: `; LED Blink Test
; Blinks the USER0 and USER1 LEDs alternately
; rate depends on sample rate PLL_RANGE DIP switches

.rn ledflag r0

; get sample counter
cpy_cs  acc32, samplecnt
andi    acc32, 0x1FFF       ; flip the bit every 8192 samples, approx. 2.93Hz at 48Khz sampling
jnz     acc32, doLED

; if the 13 lowest bits of sample counter are zero, flip the flag
; this will flip once every 8192 samples as detailed above
setFlag:
xori    ledflag, 0x0001     ; invert LSB of ledflag, result in acc32
cpy_cc  ledflag, acc32      ; store new result in ledflag

doLED:
set     user0|0, ledflag    ; set the usr0 output per the ledflag LSB
xori    ledflag, 0x0001     ; XOR LSB of register to invert its state
set     user1|0, acc32      ; set the user1 LED per the acc32 LSB`,

    fxcore_delay: `; Default program 4
;
; Delay using POT or tap switch
; Mono in/out
;
; pot0 = delay time in pot mode 
; pot1 = feedback
; pot2 = lp filter
; pot3 =
; pot4 = 
; pot5 = 
;
; tap switch = set delay time and switch to tap mode
; hold tap on first tap = switch back to POT control from tap control
;
; sw1/0: 00 - no divide (1/4 note)
;        01 - /2 (1/8th note)
;        10 - /3 (triplet)
;        11 - /4 (1/16th note)
;
; user0 = blink at delay time
; user1 = off in pot mode and on in tap mode

; temp registers for various things
.rn       temp      r0
.rn       temp1     r1
.rn       calc_delay       r2     ; final calculated delay after any divisions for 1/8th, etc
.rn       lp_con    r3            ; low-pass control register
.rn       lp        r4            ; lp filter
.rn       old_pot   r5            ; old pot time
.rn       act_count r6            ; holds active delay count from tap tempo
.rn       potnot_tap       r7     ; 0 means pot, 1 means tap tempo
.rn       blink_time       r8     ; blink time
.rn       user0_state      r9     ; user0 state
.rn       old_delay r10           ; old delay count

.equ      delay_len 32767

; Define the delay line
.mem      delay     delay_len

; pot smoothing
.sreg     pot0_k    12

; preset MAXTEMPO to the delay line length, time out should be
; equal to or shorter than the delay length
.sreg     MAXTEMPO  delay_len

; since TAPTEMPO and TAPSTKRLD are calculated and we expect
; equations to resolve to values between -1.0 and +0.99...
; we inform the assembler we really want to use integer results
; by appending ".i" to the .sreg directive

; preset the starting TAPTEMPO value to half the delay
.sreg.i   TAPTEMPO  delay_len/2

; set the "sticky" time to 1/2 the max delay time
; careful to not make this too short else every button
; press can look sticky
.sreg.i   TAPSTKRLD delay_len/2

; set debounce time, must be shorter than the sticky time
.sreg.i   TAPDBRLD  delay_len/128

; Initialize potnot_tap to 0 to select POT at startup
.creg     potnot_tap     0

; set user0 led state
.creg     user0_state    0x1

; set multiply factors into mregs, don't need to set 0
.mreg     mr1       0.5           ; 1/8 note
.mreg     mr2       0.3333333     ; triplet
.mreg     mr3       0.25          ; 1/16 note

; registers are preset on start so if potnot_tap is 0 use POT0
; any other value means use the tap button

; set LP pot control range
cpy_cs    temp, pot2_smth
multri    temp, 0.75
addsi     acc32, 0.25
cpy_cc    lp_con, acc32

; write a 0 to the delay head in case user sets pot to 0
xor       acc32, acc32            ; clear acc32
wrdel     delay, acc32            ; write 0 to head of delay

; are we "sticky"?
andi      flags, TapStky          ; check bit 4 for a sticky event
jz        acc32, next             ; if not sticky jump past rest
andi      flags, TB2nTB1          ; isolate the tap button and check if it is tap 1 or 2
jnz       acc32, next             ; if set then tap 2 sticky event so jump over rest
andi      potnot_tap, 0x0000      ; if here we got a tap 1 sticky so clear potnot_tap to use POT
cpy_cc    potnot_tap, acc32
jmp       no_tap                  ; jump to delay code



next:
; decide POT or tap
; Do we have a new TAP count?
andi      flags, newTT            ; New tap tempo?
jz        acc32, no_tap           ; if no new tap make no change
ori       potnot_tap, 0x0001      ; set the lsb to indicate we now use tt
cpy_cc    potnot_tap, acc32       ; save it
cpy_cs    act_count, taptempo     ; get the tap count into act_count
sl        act_count, 16           ; shift to 31:16
cpy_cc    act_count, acc32
jmp       do_delay

; if here no new tap but decide if we need to update count from the POT
; we need a little hystersis on the POT because even with smoothing it can
; time to settle and the LSB to stop moving. While we can not hear this
; the difference in value looks like a change to the LED flashing routine
; so only update value if it changes by more than 0.01
no_tap:
andi      potnot_tap, 0x0001      ; if lsb is 1 then we are in tap mode, no pot update
jnz       acc32, do_delay         ; not 0 so using tap count from above
cpy_cs    temp, pot0_smth         ; read in the pot value to temp1
wrdld     temp1, delay!           ; get length of the delay into temp[31:16]
multrr    temp, temp1             ; multiply for final length
cpy_cc    act_count, acc32        ; save delay time which has the integer portion in [31:16] and the interpolation coeff in [15:0]


do_delay:
; act_count holds the delay time so check if switches set to divide count
cpy_cc    calc_delay, act_count   ; copy full count into calc_delay
cpy_cs    temp, switch            ; get switch states
andi      temp, sw0|sw1           ; keep S0 and S1
jz        acc32, go_delay         ; if switches 0 then no divider and jump over rest
cpy_cmx   temp, acc32             ; else use the switches as a pointer to mregs to get divisor
multrr    calc_delay, temp        ; multiply by it
cpy_cc    calc_delay, acc32       ; and move to temp1

go_delay:
interp    calc_delay, delay       ; linearly interpolate the result from the delay line

; Add the dry signal to the delayed signal
cpy_cs    temp, in0
adds      temp, acc32

; Output it
cpy_sc    out0, acc32
cpy_sc    out1, acc32

; multiply by feedback
cpy_cs    temp, pot1
multrr    acc32, temp

; lp filter it
subs      acc32, lp
multrr    acc32, lp_con
adds      acc32, lp
cpy_cc    lp, acc32

; write to delay line
wrdel     delay, acc32


; flash LED at delay rate 50% duty cycle
; old delay time - current delay time to see if it has changed
sr        calc_delay, 16          ; put calculated delay value into acc32[15:0]
cpy_cc    calc_delay, acc32       ; save back
xor       acc32, acc32            ; clear acc32
ori       acc32, 1024             ; load 1024 into acc32[15:0]
cpy_cc    temp, acc32             ; save in temp
subs      old_delay, calc_delay   ; subtract current calculated delay from old one
abs       acc32                   ; absolute value
subs      acc32, temp             ; difference minus 1024
jneg      acc32, same             ; if negative then difference less than 1024 so jump over saving new value
; new value, set LED and update the time
ori       user0_state, 0x1        ; turn on LED
cpy_cc    user0_state, acc32      ; save current state
cpy_cc    old_delay, calc_delay   ; over write the old delay time
sr        calc_delay, 1           ; /2 for 50% duty cycle
cpy_cc    blink_time, acc32       ; copy to the blink time

same:
xor       acc32, acc32            ; clear acc32
ori       acc32, 1                ; set the LSB
subs      blink_time, acc32       ; subtract it
cpy_cc    blink_time, acc32       ; copy result to blink_time
jnz       acc32,not_zero          ; if not 0 jump over the rest
cpy_cc    old_delay, calc_delay   ; timed out, get the latest count
sr        old_delay, 1            ; load count/2 back in
cpy_cc    blink_time, acc32       ; copy to timer counter
xori      user0_state, 0x1        ; flip user0 state
cpy_cc    user0_state, acc32
not_zero:
set       user0|0, user0_state     ; bit 0 of user0_state is sent to user0 output

set       user1|0, potnot_tap      ; bit 0 of potnot_tap is sent to user1 output`,

fxcore_chorus: `; Default program 5
;
; Chorus
; Mono in/out
;
; pot0 = rate
; pot1 = depth
; pot2 = level
; pot3 = 
; pot4 = 
; pot5 =  

.equ    fs          48000
.equ    flow        .2
.equ    fhigh       10
.equ    pi          3.14159
.equ    clow        (2^31 - 1) * (2*pi*flow)/fs
.equ    chigh       (2^31 - 1) * (2*pi*fhigh)/fs
.equ    cdiff       chigh - clow

.mem    delay       1024

.rn     temp        r0
.rn     voice1      r1
.rn     voice2      r2
.rn     voice3      r3
.rn     bright      r4

cpy_cs  temp, pot0_smth           ; read in frequency control pot
wrdld   acc32, cdiff.u            ; load difference between low and high frequency
ori     acc32, cdiff.l
multrr  temp, acc32               ; pot0 * cdiff
cpy_cc  temp, acc32
wrdld   acc32, clow.u             ; load low freq coeff
ori     acc32, clow.l
adds    acc32, temp               ; add low freq
cpy_sc  lfo0_f, acc32             ; write to lfo0 frequency control

cpy_cs  temp, pot1_smth           ; read in depth control pot
wrdld   acc32, 400
multrr  temp, acc32
cpy_cc  r15, acc32

cpy_cs  temp, in0
wrdel   delay, temp

; voice 1
chr     lfo0|sin, delay+1400
cpy_cc  voice1, acc32

; voice 2
chr     lfo0|cos, delay+256
cpy_cc  voice2, acc32

; voice 3
chr     lfo0|sin|neg, delay+16
cpy_cc  voice3, acc32

; voice 4
chr     lfo0|cos|neg, delay+768

; sum the voices
adds    acc32, voice3
adds    acc32, voice2
adds    acc32, voice1

; get effects level pot and scale effect
cpy_cs  temp, pot2_smth
multrr  acc32, temp

; add in dry
cpy_cs  temp, in0
adds    acc32, temp

; write it
cpy_sc  out0, acc32
cpy_sc  out1, acc32


; The PWM value becomes updated every 256 samples translating to a
; PWM frequency of 125Hz @32k with 8 bit resolution.
; While this is not exactly a high resolution PWM it might still
; good enough for generating basic control voltages in some applications.
; For driving the LEDs in this case it is perfectly enough.
cpy_cs    acc32, samplecnt        ; Get the sample counter
andi      acc32, 0xFF             ; Mask b[7:0]
jnz       acc32, doPWM            ;

; Reload new PWM value from LFO0_s into "bright"
cpy_cs    temp, lfo0_s            ; read in sin wave ranges -1.0 to +1.0 (well, almost)
sra       temp, 1                 ; /2 to +/- 1/2
addsi     acc32, 0.5              ; ranges 0 to 1
sra       acc32, 23               ; shift the PWM value in place
cpy_cc    bright, acc32           ; save it

doPWM:
; Performing the decrement prior to driving the LED makes sure
; that the LED can go completly off.
addi      bright, -1              ; suntract 1 from on time
cpy_cc    bright, acc32           ; Save updated "bright"
xor       acc32, acc32            ; Clear acc32 for the LED off case
jneg      bright, doLED           ;
ori       acc32, 1                ; Set acc32[0] for the LED on case

doLED:
set       user0|0, acc32           ; set the usr1 output per the acc32 LSB`,

flanger: `flanger test`,

reverb: `reverb test`,

tremolo: 'tremolo test',
};