import { bend, straight, type MachineSettings, type Step } from './model';

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
    build: (s) => [straight(200), bend(90, 'up', s.radius), straight(150)],
  },
  {
    id: 'Z',
    name: 'Z (odsadzenie)',
    description: 'Dwa gięcia 45° w przeciwne strony',
    build: (s) => [straight(150), bend(45, 'up', s.radius), straight(80), bend(45, 'down', s.radius), straight(150)],
  },
  {
    id: 'U',
    name: 'U',
    description: 'Dwa gięcia 90° w tę samą stronę',
    build: (s) => [straight(150), bend(90, 'up', s.radius), straight(200), bend(90, 'up', s.radius), straight(150)],
  },
  {
    id: 'Z90',
    name: 'Z 90°',
    description: 'Dwa gięcia 90° w przeciwne strony',
    build: (s) => [straight(150), bend(90, 'up', s.radius), straight(120), bend(90, 'down', s.radius), straight(150)],
  },
  {
    id: 'offsetL',
    name: 'Odsadzenie + L',
    description: 'Odsadzenie 30° i gięcie 90°',
    build: (s) => [
      straight(120),
      bend(30, 'up', s.radius),
      straight(60),
      bend(30, 'down', s.radius),
      straight(150),
      bend(90, 'up', s.radius),
      straight(120),
    ],
  },
];
