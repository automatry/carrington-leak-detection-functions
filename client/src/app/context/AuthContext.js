// context/AuthContext.js
"use client";

import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, provider } from '@/lib/firebaseClient'; // Use alias
// import LoadingSpinner from '@/components/LoadingSpinner'; // Use alias

const AuthContext = createContext({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signIn = async () => {
    setLoading(true);
    try {
      await signInWithPopup(auth, provider);
      // Let onAuthStateChanged handle setting user and loading=false
    } catch (error) {
      console.error("Error signing in:", error);
      setLoading(false); // Ensure loading stops on error
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await signOut(auth);
       // Let onAuthStateChanged handle setting user and loading=false
    } catch (error) {
      console.error("Error signing out:", error);
      setLoading(false); // Ensure loading stops on error
    }
  };

  const value = useMemo(() => ({
    user,
    loading,
    signIn,
    signOut: handleSignOut,
  }), [user, loading]);

  // Don't render children until auth state is known
  // If loading, show spinner covering the page potentially
  // if (loading) {
  //   return <LoadingSpinner />; // This might cause layout shifts, better handle in layout?
  // }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);