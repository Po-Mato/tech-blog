import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from '../views/Home';
import About from '../views/About';
import Chat from '../views/Chat';

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/chat" element={<Chat />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRouter;