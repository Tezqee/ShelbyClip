import { NavLink } from 'react-router-dom';
import { Home, PlusSquare, User } from 'lucide-react';
import NotificationsPanel from './NotificationsPanel';

export default function BottomNav() {
  return (
    <nav className="mobile-bottom-nav">
      <NavLink to="/" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <Home size={24} />
        <span>Home</span>
      </NavLink>

      <NavLink to="/upload" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <div className="bottom-nav-plus">
          <PlusSquare size={28} color="white" />
        </div>
      </NavLink>

      <NotificationsPanel mode="bottom-nav" />

      <NavLink to="/profile" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <User size={24} />
        <span>Profile</span>
      </NavLink>
    </nav>
  );
}
