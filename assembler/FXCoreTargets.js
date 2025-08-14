/**
 * This clas is used to keep track of the targeted device and the filters to select valid devices
 */
class FXCoreTargets {
    device = null; // the target HID device selected

    FXCore_I2C = 0x30; // The I2C address of the target FXCore chip, typically 0x30 on a dev board

    FXCore_Prg = 0; // Program number to program

    // HID selection filters
    // NOTE: We assume all devices use an FT260 or emulate one. If using a different USB-I2C bridge device
    // You will need to add supports for it.
    static filters = [
        { vendorId: 0x0403, productId: 0x71D8 }, // FTDI vendor ID, Exp Noize product ID
        { vendorId: 0xBEEF, productId: 0xB00F }, // Future DAD sandbox pedal
        { vendorId: 0x2E8A, productId: 0x101F }, // Future DAD sandbox pedal
    ];
}