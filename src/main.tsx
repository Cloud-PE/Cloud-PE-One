import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 导入 Strapi 主题 - 使用正确的路径
//import "@semi-bot/semi-theme-strapi/semi.min.css";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
