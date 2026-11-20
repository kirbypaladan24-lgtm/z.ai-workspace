import { io } from 'socket.io-client';
const s = io('http://localhost:3000');
// REAL method, WRONG call shape: on(event: string, fn) — passing a number
s.on(42);
