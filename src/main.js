import WebGL from 'three/addons/capabilities/WebGL.js';
import './style.css';
import { startApp } from './app.js';
import { showNotice } from './ui/notice.js';
import { attachStartScreen } from './ui/startScreen.js';

const container = document.getElementById('app');
const startEl = document.getElementById('start');

if (WebGL.isWebGL2Available()) {
  startApp(container, { startScreen: attachStartScreen(startEl) });
} else {
  startEl?.remove();
  showNotice(container, 'Galaxy Sandbox needs WebGL 2. Turn on hardware acceleration or try another browser.');
}
