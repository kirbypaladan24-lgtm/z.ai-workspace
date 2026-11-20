import { io } from 'socket.io-client';
const s = io('http://localhost:3000');
// fabricated API: plausible name, does not exist in socket.io-client 4.8.4
s.setReconnectionLag(5);
