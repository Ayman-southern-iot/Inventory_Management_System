/**
 * The initial category tree, transcribed from `category-taxonomy-spec.md` §2.
 *
 * Reference data, seeded idempotently by `pnpm db:seed` (spec §1, §9) — deliberately not a
 * hardcoded array inside a service, and deliberately not a migration, because
 * `rules/40-database.md` keeps business data out of migrations and in seeds.
 *
 * "Treat this as a starting point, not a closed list" (spec §2). Everything here is editable,
 * movable and extendable through the category-management screen from the moment it lands; the
 * point of seeding it is that the IM starts from a usable tree rather than an empty one.
 *
 * Every top-level branch carries a `Miscellaneous` leaf (spec §5 step 3), so a product that
 * fits a branch but no subcategory always has somewhere to go that is not `NULL`.
 */
export interface SeedCategory {
  name: string;
  children?: SeedCategory[];
}

/** Added to every top-level branch, so data entry is never blocked for want of a leaf. */
const MISC = 'Miscellaneous';

export const CATEGORY_SEED_TREE: SeedCategory[] = [
  {
    name: 'Electronics',
    children: [
      {
        name: 'Passive Components',
        children: [
          { name: 'Resistors' },
          { name: 'Capacitors' },
          { name: 'Inductors' },
          { name: 'Potentiometers / Trimmers' },
        ],
      },
      {
        name: 'Semiconductors',
        children: [
          { name: 'Diodes & Rectifiers' },
          { name: 'Transistors & MOSFETs' },
          { name: 'Optocouplers' },
          { name: 'ICs (general)' },
        ],
      },
      {
        name: 'Electromechanical',
        children: [{ name: 'Relays' }, { name: 'Switches' }, { name: 'Buzzers / Fans' }],
      },
      {
        name: 'Microcontrollers & Processors',
        children: [
          { name: 'ESP32 / ESP8266' },
          { name: 'Arduino / AVR' },
          { name: 'STM32 / ARM' },
          { name: 'Raspberry Pi / SBC' },
        ],
      },
      {
        name: 'Sensors',
        children: [
          { name: 'Temperature & Humidity' },
          { name: 'Motion / IMU' },
          { name: 'Proximity & Distance' },
          { name: 'Current / Voltage' },
          { name: 'Optical / Imaging' },
        ],
      },
      {
        name: 'Breakout Boards & Modules',
        children: [
          { name: 'Communication' },
          { name: 'Power Modules' },
          { name: 'Driver Modules' },
          { name: 'Display Modules' },
        ],
      },
      {
        name: 'Motor Drivers & Power Electronics',
        children: [
          { name: 'Stepper Drivers' },
          { name: 'DC Motor Drivers / H-Bridges' },
          { name: 'Servo Drivers / ESCs' },
        ],
      },
      {
        name: 'Custom & Assembled PCBs',
        children: [{ name: 'Custom Fabricated PCBs' }, { name: 'Assembled Boards' }],
      },
      {
        name: 'Connectors & Cables',
        children: [
          { name: 'Board Connectors' },
          { name: 'Jacks' },
          { name: 'Antennas & RF Accessories' },
          { name: 'Cables' },
          { name: 'Industrial Connectors' },
        ],
      },
      {
        name: 'Prototyping',
        children: [
          { name: 'Vero Board / Stripboard' },
          { name: 'Breadboards' },
          { name: 'Blank PCBs / Perfboard' },
        ],
      },
      {
        name: 'Tools & Test Equipment',
        children: [
          { name: 'Measurement' },
          { name: 'Soldering & Assembly' },
          { name: 'Bench Supplies' },
        ],
      },
    ],
  },
  {
    name: 'Mechanical & Structural',
    children: [
      {
        name: 'Fasteners',
        children: [
          { name: 'Screws & Bolts' },
          { name: 'Nuts & Washers' },
          { name: 'Standoffs / Spacers' },
        ],
      },
      {
        name: 'Motion Components',
        children: [
          { name: 'Bearings' },
          { name: 'Shaft Couplers' },
          { name: 'Lead Screws / Rods' },
          { name: 'Linear Rails / Guides' },
          { name: 'Pulleys / Belts / Gears' },
        ],
      },
      {
        name: 'Structural',
        children: [
          { name: 'Aluminum Extrusion' },
          { name: 'Brackets & Plates' },
          { name: 'Enclosures' },
        ],
      },
      {
        name: 'Actuators',
        children: [{ name: 'DC Motors' }, { name: 'Stepper Motors' }, { name: 'Servo Motors' }],
      },
      {
        name: 'Hand & Mechanical Tools',
        children: [
          { name: 'Striking Tools' },
          { name: 'Screwdrivers & Wrenches' },
          { name: 'Pliers & Cutters' },
          { name: 'General Hand Tools' },
        ],
      },
    ],
  },
  {
    name: 'Machines & Equipment',
    children: [
      {
        name: 'CNC & Laser Equipment',
        children: [
          { name: 'CNC Routers' },
          { name: 'Router Bits' },
          { name: 'Laser Machines' },
          { name: 'Laser Modules / Diodes' },
          { name: 'Laser Accessories' },
        ],
      },
      {
        name: '3D Printing',
        children: [
          { name: '3D Printers' },
          { name: 'Hotends / Extruders' },
          { name: 'Filament' },
          { name: 'Print Beds / Build Surfaces' },
        ],
      },
      {
        name: 'Robotics & Drones',
        children: [
          { name: 'Robot Kits / Chassis' },
          { name: 'Robot Arms' },
          { name: 'Drones / Drone Kits' },
        ],
      },
      {
        name: 'Networking & Communication Equipment',
        children: [
          { name: 'Wi-Fi Routers / Gateways' },
          { name: 'Access Points / Networking Hardware' },
        ],
      },
      {
        name: 'Lab / Bench Equipment',
        children: [{ name: 'Workbenches' }, { name: 'Fume Extractors' }, { name: 'Storage Bins' }],
      },
    ],
  },
  {
    name: 'Consumables & Misc',
    children: [
      {
        name: 'Wires & Heat Shrink',
        children: [
          { name: 'Hookup / Normal Wire' },
          { name: 'Jumper Wires' },
          { name: 'Heat Shrink Tubing / Wire Loom' },
        ],
      },
      {
        name: 'Adhesives & Tapes',
        children: [{ name: 'Tapes' }, { name: 'Glue Gun Sticks / Adhesives' }],
      },
      {
        name: 'Batteries & Power Supplies',
        children: [
          { name: 'Li-ion / LiPo' },
          { name: 'AA / AAA / Coin Cell' },
          { name: 'Wall Adapters / Chargers' },
        ],
      },
    ],
  },
].map((branch) => ({
  ...branch,
  // Spec §5 step 3: every top-level branch gets one, so "fits here but no subcategory matches"
  // always has an answer that is not a guess.
  children: [...(branch.children ?? []), { name: MISC }],
}));
