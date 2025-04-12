// components/LoginPrompt.js
"use client";

import { useAuth } from '@/app/context/AuthContext'; // Use alias
import styles from './LoginPrompt.module.css';

export default function LoginPrompt() {
  const { signIn } = useAuth();

  return (
    <div className={styles.container}>
      <h2>Please Sign In</h2>
      <p>Access to the BACnet Device Monitor requires authentication.</p>
      <button onClick={signIn} className="button">
        Sign In with Google
      </button>
    </div>
  );
}