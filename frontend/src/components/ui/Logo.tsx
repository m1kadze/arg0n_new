import React from 'react';
import logo from '../../assets/logo.svg';

export const Logo: React.FC = () => {
  return (
    <div className="tg-logo-wrapper">
      <img src={logo} alt="Logo" className="tg-logo" />
    </div>
  );
};
