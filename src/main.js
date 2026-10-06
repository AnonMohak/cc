import WebGL from 'three/addons/capabilities/WebGL.js';
import './style.css';
import { startApp } from './app.js';
import { showNotice } from './ui/notice.js';

const container = document.getElementById('app');

if (WebGL.isWebGL2Available()) {
  startApp(container);
} else {
  document.querySelector('.hint')?.remove();
  showNotice(container, 'Galaxy Sandbox needs WebGL 2. Turn on hardware acceleration or try another browser.');
}
