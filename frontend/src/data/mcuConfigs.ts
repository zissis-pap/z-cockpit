import type { McuFamily } from '../types'

export const INTERFACES = [
  { id: 'stlink',     name: 'ST-Link',     config: 'interface/stlink.cfg' },
  { id: 'stlink_v2',  name: 'ST-Link v2',  config: 'interface/stlink-v2.cfg' },
  { id: 'stlink_v21', name: 'ST-Link v2.1',config: 'interface/stlink-v2-1.cfg' },
  { id: 'jlink',      name: 'J-Link',      config: 'interface/jlink.cfg' },
  { id: 'cmsis_dap',  name: 'CMSIS-DAP',   config: 'interface/cmsis-dap.cfg' },
  { id: 'ftdi',       name: 'FTDI',        config: 'interface/ftdi/ft232h-module-swd.cfg' },
]

export const MCU_FAMILIES: McuFamily[] = [
  {
    id: 'stm32f0', name: 'STM32F0', config: 'target/stm32f0x.cfg',
    series: [
      { id: 'stm32f030', name: 'STM32F030', config: 'target/stm32f0x.cfg' },
      { id: 'stm32f051', name: 'STM32F051', config: 'target/stm32f0x.cfg' },
      { id: 'stm32f072', name: 'STM32F072', config: 'target/stm32f0x.cfg' },
      { id: 'stm32f091', name: 'STM32F091', config: 'target/stm32f0x.cfg' },
    ],
  },
  {
    id: 'stm32f1', name: 'STM32F1', config: 'target/stm32f1x.cfg',
    series: [
      { id: 'stm32f100', name: 'STM32F100', config: 'target/stm32f1x.cfg' },
      { id: 'stm32f101', name: 'STM32F101', config: 'target/stm32f1x.cfg' },
      { id: 'stm32f103', name: 'STM32F103', config: 'target/stm32f1x.cfg' },
      { id: 'stm32f105', name: 'STM32F105', config: 'target/stm32f1x.cfg' },
      { id: 'stm32f107', name: 'STM32F107', config: 'target/stm32f1x.cfg' },
    ],
  },
  {
    id: 'stm32f2', name: 'STM32F2', config: 'target/stm32f2x.cfg',
    series: [
      { id: 'stm32f205', name: 'STM32F205', config: 'target/stm32f2x.cfg' },
      { id: 'stm32f207', name: 'STM32F207', config: 'target/stm32f2x.cfg' },
      { id: 'stm32f215', name: 'STM32F215', config: 'target/stm32f2x.cfg' },
      { id: 'stm32f217', name: 'STM32F217', config: 'target/stm32f2x.cfg' },
    ],
  },
  {
    id: 'stm32f3', name: 'STM32F3', config: 'target/stm32f3x.cfg',
    series: [
      { id: 'stm32f301', name: 'STM32F301', config: 'target/stm32f3x.cfg' },
      { id: 'stm32f302', name: 'STM32F302', config: 'target/stm32f3x.cfg' },
      { id: 'stm32f303', name: 'STM32F303', config: 'target/stm32f3x.cfg' },
      { id: 'stm32f334', name: 'STM32F334', config: 'target/stm32f3x.cfg' },
      { id: 'stm32f373', name: 'STM32F373', config: 'target/stm32f3x.cfg' },
    ],
  },
  {
    id: 'stm32f4', name: 'STM32F4', config: 'target/stm32f4x.cfg',
    series: [
      { id: 'stm32f401', name: 'STM32F401', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f405', name: 'STM32F405', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f407', name: 'STM32F407', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f411', name: 'STM32F411', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f412', name: 'STM32F412', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f413', name: 'STM32F413', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f415', name: 'STM32F415', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f417', name: 'STM32F417', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f427', name: 'STM32F427', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f429', name: 'STM32F429', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f437', name: 'STM32F437', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f439', name: 'STM32F439', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f446', name: 'STM32F446', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f469', name: 'STM32F469', config: 'target/stm32f4x.cfg' },
      { id: 'stm32f479', name: 'STM32F479', config: 'target/stm32f4x.cfg' },
    ],
  },
  {
    id: 'stm32f7', name: 'STM32F7', config: 'target/stm32f7x.cfg',
    series: [
      { id: 'stm32f722', name: 'STM32F722', config: 'target/stm32f7x.cfg' },
      { id: 'stm32f745', name: 'STM32F745', config: 'target/stm32f7x.cfg' },
      { id: 'stm32f746', name: 'STM32F746', config: 'target/stm32f7x.cfg' },
      { id: 'stm32f767', name: 'STM32F767', config: 'target/stm32f7x.cfg' },
      { id: 'stm32f769', name: 'STM32F769', config: 'target/stm32f7x.cfg' },
    ],
  },
  {
    id: 'stm32h7', name: 'STM32H7', config: 'target/stm32h7x.cfg',
    series: [
      { id: 'stm32h743', name: 'STM32H743', config: 'target/stm32h7x.cfg' },
      { id: 'stm32h745', name: 'STM32H745', config: 'target/stm32h7x_dual_bank.cfg' },
      { id: 'stm32h747', name: 'STM32H747', config: 'target/stm32h7x_dual_bank.cfg' },
      { id: 'stm32h750', name: 'STM32H750', config: 'target/stm32h7x.cfg' },
      { id: 'stm32h753', name: 'STM32H753', config: 'target/stm32h7x.cfg' },
    ],
  },
  {
    id: 'stm32l0', name: 'STM32L0', config: 'target/stm32l0.cfg',
    series: [
      { id: 'stm32l010', name: 'STM32L010', config: 'target/stm32l0.cfg' },
      { id: 'stm32l051', name: 'STM32L051', config: 'target/stm32l0.cfg' },
      { id: 'stm32l073', name: 'STM32L073', config: 'target/stm32l0.cfg' },
    ],
  },
  {
    id: 'stm32l1', name: 'STM32L1', config: 'target/stm32l1.cfg',
    series: [
      { id: 'stm32l151', name: 'STM32L151', config: 'target/stm32l1.cfg' },
      { id: 'stm32l152', name: 'STM32L152', config: 'target/stm32l1.cfg' },
      { id: 'stm32l162', name: 'STM32L162', config: 'target/stm32l1.cfg' },
    ],
  },
  {
    id: 'stm32l4', name: 'STM32L4', config: 'target/stm32l4x.cfg',
    series: [
      { id: 'stm32l432', name: 'STM32L432', config: 'target/stm32l4x.cfg' },
      { id: 'stm32l433', name: 'STM32L433', config: 'target/stm32l4x.cfg' },
      { id: 'stm32l452', name: 'STM32L452', config: 'target/stm32l4x.cfg' },
      { id: 'stm32l476', name: 'STM32L476', config: 'target/stm32l4x.cfg' },
      { id: 'stm32l496', name: 'STM32L496', config: 'target/stm32l4x.cfg' },
    ],
  },
  {
    id: 'stm32l4plus', name: 'STM32L4+', config: 'target/stm32l4x.cfg',
    series: [
      { id: 'stm32l4r5', name: 'STM32L4R5', config: 'target/stm32l4x.cfg' },
      { id: 'stm32l4r9', name: 'STM32L4R9', config: 'target/stm32l4x.cfg' },
      { id: 'stm32l4s9', name: 'STM32L4S9', config: 'target/stm32l4x.cfg' },
    ],
  },
  {
    id: 'stm32l5', name: 'STM32L5', config: 'target/stm32l5x.cfg',
    series: [
      { id: 'stm32l552', name: 'STM32L552', config: 'target/stm32l5x.cfg' },
      { id: 'stm32l562', name: 'STM32L562', config: 'target/stm32l5x.cfg' },
    ],
  },
  {
    id: 'stm32g0', name: 'STM32G0', config: 'target/stm32g0x.cfg',
    series: [
      { id: 'stm32g030', name: 'STM32G030', config: 'target/stm32g0x.cfg' },
      { id: 'stm32g071', name: 'STM32G071', config: 'target/stm32g0x.cfg' },
      { id: 'stm32g081', name: 'STM32G081', config: 'target/stm32g0x.cfg' },
    ],
  },
  {
    id: 'stm32g4', name: 'STM32G4', config: 'target/stm32g4x.cfg',
    series: [
      { id: 'stm32g431', name: 'STM32G431', config: 'target/stm32g4x.cfg' },
      { id: 'stm32g474', name: 'STM32G474', config: 'target/stm32g4x.cfg' },
      { id: 'stm32g484', name: 'STM32G484', config: 'target/stm32g4x.cfg' },
    ],
  },
  {
    id: 'stm32u5', name: 'STM32U5', config: 'target/stm32u5x.cfg',
    series: [
      { id: 'stm32u575', name: 'STM32U575', config: 'target/stm32u5x.cfg' },
      { id: 'stm32u585', name: 'STM32U585', config: 'target/stm32u5x.cfg' },
    ],
  },
  {
    id: 'stm32wb', name: 'STM32WB', config: 'target/stm32wbx.cfg',
    series: [
      { id: 'stm32wb50', name: 'STM32WB50', config: 'target/stm32wbx.cfg' },
      { id: 'stm32wb55', name: 'STM32WB55', config: 'target/stm32wbx.cfg' },
    ],
  },
  {
    id: 'stm32wl', name: 'STM32WL', config: 'target/stm32wlx.cfg',
    series: [
      { id: 'stm32wl55', name: 'STM32WL55', config: 'target/stm32wlx.cfg' },
      { id: 'stm32wle5', name: 'STM32WLE5', config: 'target/stm32wlx.cfg' },
    ],
  },
]

export const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200,
  230400, 460800, 921600, 1000000, 2000000,
]
