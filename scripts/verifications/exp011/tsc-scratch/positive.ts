import { io } from 'socket.io-client';
const s = io('http://localhost:3000', { transports: ['websocket'] });
s.on('connect', () => { console.log('connected', s.id); });
s.emit('hello', { a: 1 });
