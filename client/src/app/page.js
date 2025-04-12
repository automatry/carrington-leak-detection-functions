// app/page.js
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation'; // Use App Router navigation
import { useAuth } from '@/app/context/AuthContext'; // Use alias
import LoadingSpinner from '@/app/components/LoadingSpinner'; // Use alias
import LoginPrompt from '@/app/components/LoginPrompt'; // Use alias
import styles from '@/app/styles/Page.module.css'

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If done loading and user is logged in, redirect to devices page
    if (!loading && user) {
      router.replace('/devices'); // Use replace to avoid back button going here
    }
  }, [user, loading, router]);

  // Show loading spinner while checking auth state
  if (loading) {
    return <LoadingSpinner />;
  }

  // If not loading and not logged in, show login prompt/welcome
  if (!user) {
    return (
       <div className={styles.container}>
            <h1>Welcome to the BACnet Monitor</h1>
            <LoginPrompt />
       </div>
    );
  }

  // If logged in but redirect hasn't happened yet (should be brief)
  return <LoadingSpinner />; // Or null
}