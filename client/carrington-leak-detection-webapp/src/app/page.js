"use client";

import { useState, useEffect } from "react";
import { signInWithPopup, signOut } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import { auth, provider, db } from "../../lib/firebaseClient";
import styles from "../../styles/Home.module.css"

export default function Home() {
  const [user, setUser] = useState(null);
  const [apartments, setApartments] = useState([]);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((u) => {
      setUser(u);
    });
    return unsubscribe;
  }, []);

  // Sign in with Google
  const handleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      setUser(result.user);
    } catch (error) {
      console.error("Error signing in:", error);
    }
  };

  // Sign out
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // Subscribe to apartments collection once signed in
  useEffect(() => {
    if (user) {
      const unsub = onSnapshot(collection(db, "apartments"), (snapshot) => {
        const data = snapshot.docs.map((doc) => {
          const docData = doc.data();
          return {
            id: doc.id,
            apartment: docData.apartment || doc.id,
            status: docData.status,
            lastUpdate: docData.lastUpdate,
            deviceIP: docData.deviceIP,
            // You can include additional fields if needed.
          };
        });
        setApartments(data);
      });
      return () => unsub();
    }
  }, [user]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Carrington Leak Detection Monitor</h1>
        {user ? (
          <div className={styles.userInfo}>
            <span>Signed in as {user.displayName}</span>
            <button onClick={handleSignOut} className={styles.button}>
              Sign Out
            </button>
          </div>
        ) : (
          <button onClick={handleSignIn} className={styles.button}>
            Sign In with Google
          </button>
        )}
      </header>
      {user && (
        <main>
          <h2>Apartment Status</h2>
          {apartments.length === 0 ? (
            <p>No apartments found.</p>
          ) : (
            <div className={styles.apartmentList}>
              {apartments.map((apt) => (
                <div key={apt.id} className={styles.apartmentCard}>
                  <h3>{apt.apartment}</h3>
                  <p>
                    <strong>Status:</strong>{" "}
                    <span
                      className={
                        apt.status &&
                        (apt.status.read_value === 1 ||
                          (typeof apt.status.read_value === "boolean" &&
                            apt.status.read_value))
                          ? styles.active
                          : styles.inactive
                      }
                    >
                      {apt.status &&
                      (apt.status.read_value === 1 ||
                        (typeof apt.status.read_value === "boolean" &&
                          apt.status.read_value))
                        ? "Active"
                        : "Inactive"}
                    </span>
                  </p>
                  <p>
                    <strong>Last Update:</strong>{" "}
                    {apt.lastUpdate
                      ? new Date(apt.lastUpdate.seconds * 1000).toLocaleString()
                      : "N/A"}
                  </p>
                  <p>
                    <strong>Device IP:</strong> {apt.deviceIP || "N/A"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </main>
      )}
    </div>
  );
}
