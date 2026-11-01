import { bend, straight, twist, type MachineSettings, type Step } from './model';

export interface Template {
  id: string;
  name: string;
  description: string;
  build: (s: MachineSettings) => Step[];
}

export const TEMPLATES: Template[] = [
  {
    id: 'straight',
    name: 'Prosta',
    description: 'Sam odcinek prosty',
    build: () => [straight(300)],
  },
  {
    id: 'L',
    name: 'L',
    description: 'Jedno gięcie 90°',
    build: (s) => [straight(200), bend('flat', 90, 'up', s.radiusFlat), straight(150)],
  },
  {
    id: 'Z',
    name: 'Z (odsadzenie)',
    description: 'Dwa gięcia 45° w przeciwne strony',
    build: (s) => [
      straight(150),
      bend('flat', 45, 'up', s.radiusFlat),
      straight(80),
      bend('flat', 45, 'down', s.radiusFlat),
      straight(150),
    ],
  },
  {
    id: 'U',
    name: 'U',
    description: 'Dwa gięcia 90° w tę samą stronę',
    build: (s) => [
      straight(150),
      bend('flat', 90, 'up', s.radiusFlat),
      straight(200),
      bend('flat', 90, 'up', s.radiusFlat),
      straight(150),
    ],
  },
  {
    id: 'edge',
    name: 'Kant 90°',
    description: 'Gięcie na kant + gięcie płaskie',
    build: (s) => [
      straight(250),
      bend('edge', 90, 'right', s.radiusEdge),
      straight(200),
      bend('flat', 90, 'down', s.radiusFlat),
      straight(120),
    ],
  },
  {
    id: 'twist',
    name: 'Skręt + L',
    description: 'Skręt 90° i gięcie',
    build: (s) => [
      straight(150),
      twist(90, 100),
      straight(100),
      bend('flat', 90, 'up', s.radiusFlat),
      straight(150),
    ],
  },
];
