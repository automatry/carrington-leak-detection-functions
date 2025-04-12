// components/AuthGuard.js
"use client";

import { useAuth } from '@/app/context/AuthContext'; // Use alias
import LoginPrompt from './LoginPrompt';
import LoadingSpinner from './LoadingSpinner'; // Import spinner

export default function AuthGuard({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    // Show a spinner centered within the main content area
    return <LoadingSpinner fullPage={false} />;
  }

  if (!user) {
    return <LoginPrompt />;
  }

  return <>{children}</>;
}