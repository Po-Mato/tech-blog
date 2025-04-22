import React from 'react';
import { Link } from 'react-router-dom';
import './NavigationBar.scss';

const NavigationBar = () => {
  return (
    <nav className="left-nav">
      <h2 className="nav-title">Pomato</h2>
      <ul className="nav-list">
        <li>
          <Link to="/">🏠</Link>
        </li>
        <li>
          <Link to="/game">Game</Link>
        </li>
        <li>
          <Link to="/chat">Chat</Link>
        </li>
      </ul>
    </nav>
  );
};

export default NavigationBar;
