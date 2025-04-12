// components/Header.js
"use client";

import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';
import styles from './Header.module.css';

export default function Header() {
  const { user, signIn, signOut } = useAuth();

  return (
    <header className={styles.header}>
      <div className={styles.logoContainer}>
        <Link href="/">BACnet Monitor</Link> {/* Simple Text Logo */}
      </div>
      <nav className={styles.nav}>
         {user && ( // Show nav links only if logged in
            <>
                <Link href="/devices" className={styles.navLink}>Devices</Link>
                <Link href="/notifications" className={styles.navLink}>Notifications</Link>
                <Link href="/settings" className={styles.navLink}>Settings</Link>
            </>
         )}
      </nav>
      <div className={styles.authContainer}>
        {user ? (
          <>
            <span className={styles.userName}>Hi, {user.displayName?.split(' ')[0]}</span>
            <button onClick={signOut} className="button button-secondary">
              Sign Out
            </button>
          </>
        ) : (
          <button onClick={signIn} className="button">
            Sign In
          </button>
        )}
      </div>
    </header>
  );
}