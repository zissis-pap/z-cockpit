import type { McuManufacturer } from '../types'

export const INTERFACES = [
  { id: 'stlink',     name: 'ST-Link',     config: 'interface/stlink.cfg' },
  { id: 'stlink_v2',  name: 'ST-Link v2',  config: 'interface/stlink-v2.cfg' },
  { id: 'stlink_v21', name: 'ST-Link v2.1',config: 'interface/stlink-v2-1.cfg' },
  { id: 'jlink',      name: 'J-Link',      config: 'interface/jlink.cfg' },
  { id: 'cmsis_dap',  name: 'CMSIS-DAP',   config: 'interface/cmsis-dap.cfg' },
  { id: 'stlink_v3',  name: 'ST-Link v3',  config: 'interface/stlink-v3.cfg' },
  { id: 'ftdi',       name: 'FTDI',        config: 'interface/ftdi/ft232h-module-swd.cfg' },
]

export const MCU_MANUFACTURERS: McuManufacturer[] = [
  {
    name: 'STMicroelectronics',
    targets: [
      { name: 'STM32F0x',           config: 'target/stm32f0x.cfg' },
      { name: 'STM32F1x',           config: 'target/stm32f1x.cfg' },
      { name: 'STM32F2x',           config: 'target/stm32f2x.cfg' },
      { name: 'STM32F3x',           config: 'target/stm32f3x.cfg' },
      { name: 'STM32F4x',           config: 'target/stm32f4x.cfg' },
      { name: 'STM32F7x',           config: 'target/stm32f7x.cfg' },
      { name: 'STM32G0x',           config: 'target/stm32g0x.cfg' },
      { name: 'STM32G4x',           config: 'target/stm32g4x.cfg' },
      { name: 'STM32H7x',           config: 'target/stm32h7x.cfg' },
      { name: 'STM32H7x (dual bank)',config: 'target/stm32h7x_dual_bank.cfg' },
      { name: 'STM32L0x',           config: 'target/stm32l0.cfg' },
      { name: 'STM32L0x (dual bank)',config: 'target/stm32l0_dual_bank.cfg' },
      { name: 'STM32L1x',           config: 'target/stm32l1.cfg' },
      { name: 'STM32L4x',           config: 'target/stm32l4x.cfg' },
      { name: 'STM32L5x',           config: 'target/stm32l5x.cfg' },
      { name: 'STM32MP15x',         config: 'target/stm32mp15x.cfg' },
      { name: 'STM32U5x',           config: 'target/stm32u5x.cfg' },
      { name: 'STM32WBx',           config: 'target/stm32wbx.cfg' },
      { name: 'STM32WLx',           config: 'target/stm32wlx.cfg' },
    ],
  },
  {
    name: 'Nordic Semiconductor',
    targets: [
      { name: 'nRF51x',  config: 'target/nrf51.cfg' },
      { name: 'nRF52x',  config: 'target/nrf52.cfg' },
      { name: 'nRF5340', config: 'target/nrf5340.cfg' },
      { name: 'nRF9160', config: 'target/nrf9160.cfg' },
    ],
  },
  {
    name: 'NXP',
    targets: [
      { name: 'LPC2000',   config: 'target/lpc2000.cfg' },
      { name: 'LPC17xx',   config: 'target/lpc17xx.cfg' },
      { name: 'LPC18xx',   config: 'target/lpc18xx.cfg' },
      { name: 'LPC4xxx',   config: 'target/lpc4xxx.cfg' },
      { name: 'LPC55xx',   config: 'target/lpc55xx.cfg' },
      { name: 'i.MX RT',   config: 'target/imxrt.cfg' },
      { name: 'Kinetis Kx',config: 'target/kx.cfg' },
      { name: 'KE1xZ',     config: 'target/ke1xz.cfg' },
    ],
  },
  {
    name: 'Microchip / Atmel',
    targets: [
      { name: 'SAM3x',    config: 'target/at91sam3ax.cfg' },
      { name: 'SAM3n',    config: 'target/at91sam3nx.cfg' },
      { name: 'SAM3s',    config: 'target/at91sam3sx.cfg' },
      { name: 'SAM4L',    config: 'target/at91sam4lx.cfg' },
      { name: 'SAM4s',    config: 'target/at91sam4sx.cfg' },
      { name: 'SAMD/L/C', config: 'target/at91samdXX.cfg' },
      { name: 'SAME5x',   config: 'target/atsame5x.cfg' },
      { name: 'SAM9',     config: 'target/at91sam9.cfg' },
      { name: 'SAMA5',    config: 'target/sama5d3.cfg' },
      { name: 'PIC32MX',  config: 'target/pic32mx.cfg' },
      { name: 'PIC32MZ',  config: 'target/pic32mzef.cfg' },
    ],
  },
  {
    name: 'Raspberry Pi',
    targets: [
      { name: 'RP2040', config: 'target/rp2040.cfg' },
      { name: 'RP2350', config: 'target/rp2350.cfg' },
    ],
  },
  {
    name: 'Espressif',
    targets: [
      { name: 'ESP32',    config: 'target/esp32.cfg' },
      { name: 'ESP32-S2', config: 'target/esp32s2.cfg' },
      { name: 'ESP32-S3', config: 'target/esp32s3.cfg' },
      { name: 'ESP32-C3', config: 'target/esp32c3.cfg' },
      { name: 'ESP32-H2', config: 'target/esp32h2.cfg' },
    ],
  },
  {
    name: 'Silicon Labs',
    targets: [
      { name: 'EFM32',  config: 'target/efm32.cfg' },
      { name: 'EFR32',  config: 'target/efr32.cfg' },
      { name: 'EZR32',  config: 'target/ezr32.cfg' },
    ],
  },
  {
    name: 'Texas Instruments',
    targets: [
      { name: 'CC13xx',   config: 'target/cc13xx.cfg' },
      { name: 'CC26xx',   config: 'target/cc26xx.cfg' },
      { name: 'CC32xx',   config: 'target/cc32xx.cfg' },
      { name: 'TM4C123',  config: 'target/tm4c123.cfg' },
      { name: 'TM4C129',  config: 'target/tm4c129.cfg' },
      { name: 'MSP432P4', config: 'target/msp432p4.cfg' },
    ],
  },
  {
    name: 'Infineon',
    targets: [
      { name: 'XMC1xxx', config: 'target/xmc1xxx.cfg' },
      { name: 'XMC4xxx', config: 'target/xmc4xxx.cfg' },
      { name: 'PSoC 6',  config: 'target/psoc6.cfg' },
      { name: 'PSoC 4',  config: 'target/psoc4.cfg' },
    ],
  },
  {
    name: 'GigaDevice',
    targets: [
      { name: 'GD32VF103', config: 'target/gd32vf103.cfg' },
      { name: 'GD32F1xx',  config: 'target/gd32f1x0.cfg' },
      { name: 'GD32F3xx',  config: 'target/gd32f3x0.cfg' },
      { name: 'GD32F4xx',  config: 'target/gd32f4xx.cfg' },
    ],
  },
  {
    name: 'Renesas',
    targets: [
      { name: 'RX',  config: 'target/rx.cfg' },
      { name: 'RA',  config: 'target/ra.cfg' },
      { name: 'RZ',  config: 'target/rz.cfg' },
    ],
  },
  {
    name: 'Nuvoton',
    targets: [
      { name: 'NuMicro M0',  config: 'target/numicroM0.cfg' },
      { name: 'NuMicro M23', config: 'target/numicroM23.cfg' },
      { name: 'NuMicro M4',  config: 'target/numicroM4.cfg' },
    ],
  },
  {
    name: 'ARM / Generic',
    targets: [
      { name: 'Cortex-M0',  config: 'target/cortex_m.cfg' },
      { name: 'Cortex-M3',  config: 'target/cortex_m.cfg' },
      { name: 'Cortex-M4',  config: 'target/cortex_m.cfg' },
      { name: 'Cortex-M7',  config: 'target/cortex_m.cfg' },
      { name: 'Cortex-M33', config: 'target/cortex_m.cfg' },
      { name: 'Cortex-A',   config: 'target/cortex_a.cfg' },
      { name: 'Cortex-R',   config: 'target/cortex_r4.cfg' },
    ],
  },
]

export const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200,
  230400, 460800, 921600, 1000000, 2000000,
]
