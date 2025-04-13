// components/DeviceList.js
"use client";

import { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';
import DeviceCard from './DeviceCard';
import LoadingSpinner from './LoadingSpinner';
import styles from './DeviceList.module.css';
import { useRouter } from 'next/navigation';

export default function DeviceList() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProject, setFilterProject] = useState('all');
  // --- Filter States ---
  const [filterProvisioned, setFilterProvisioned] = useState('all'); // 'all', 'yes', 'no'
  const [filterCommissioned, setFilterCommissioned] = useState('all'); // 'all', 'yes', 'no'
  // --- End Filter States ---
  const [viewMode, setViewMode] = useState('card');
  const router = useRouter();

  useEffect(() => {
    setLoading(true);
    setError(null);
    // Query to fetch devices - consider ordering by a field like 'createdAt' or 'apartmentName'
    const q = query(collection(db, 'devices'), orderBy('identity.APARTMENT', 'asc')); // Example order

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const deviceData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      console.log("Fetched devices:", deviceData); // Log fetched data
      setDevices(deviceData);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching devices:", err);
      setError("Failed to load devices. Please try again later.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // --- REFINED Filtering Logic ---
  const filteredDevices = useMemo(() => {
    // Start with all devices from state
    let result = devices;
    console.log(`Filtering ${devices.length} devices. Filters:`, { searchTerm, filterProject, filterProvisioned, filterCommissioned });

    // Apply Search Filter
    if (searchTerm) {
        const lowerSearch = searchTerm.toLowerCase();
        result = result.filter(dev => {
            const isMatch = (
                (dev.identity?.APARTMENT?.toLowerCase() || '').includes(lowerSearch) ||
                dev.id.toLowerCase().includes(lowerSearch) ||
                (dev.identity?.PROJECT?.toLowerCase() || '').includes(lowerSearch) ||
                (dev.friendlyName?.toLowerCase() || '').includes(lowerSearch) ||
                (dev.serial?.toLowerCase() || '').includes(lowerSearch)
            );
            // Optional: Log specific device exclusion
            // if (!isMatch) console.log(`Device ${dev.id} excluded by search: '${searchTerm}'`);
            return isMatch;
        });
    }

    // Apply Project Filter
    if (filterProject !== 'all') {
         result = result.filter(dev => {
             const isMatch = (dev.identity?.PROJECT || 'Unassigned') === filterProject;
             // Optional: Log specific device exclusion
             // if (!isMatch) console.log(`Device ${dev.id} excluded by project: '${filterProject}' (Device project: '${dev.identity?.PROJECT || 'Unassigned'}')`);
            return isMatch;
        });
    }

    // Apply Provisioned Filter
    if (filterProvisioned !== 'all') {
        // Determine the boolean value we are checking against
        const shouldBeProvisioned = filterProvisioned === 'yes';
        result = result.filter(dev => {
            // Ensure comparison treats missing field as 'false'
            const isProvisioned = dev.registered === true;
            const isMatch = isProvisioned === shouldBeProvisioned;
             // Optional: Log specific device exclusion
            // if (!isMatch) console.log(`Device ${dev.id} excluded by provisioned filter: '${filterProvisioned}'. Device registered=${dev.registered}, shouldBe=${shouldBeProvisioned}, is=${isProvisioned}`);
            return isMatch;
        });
    }

     // Apply Commissioned Filter
     if (filterCommissioned !== 'all') {
        // Determine the boolean value we are checking against
        const shouldBeCommissioned = filterCommissioned === 'yes';
        result = result.filter(dev => {
            // Ensure comparison treats missing field as 'false'
            const isCommissioned = dev.identity?.commissioned === true;
            const isMatch = isCommissioned === shouldBeCommissioned;
             // Optional: Log specific device exclusion
             // if (!isMatch) console.log(`Device ${dev.id} excluded by commissioned filter: '${filterCommissioned}'. Device commissioned=${dev.identity?.commissioned}, shouldBe=${shouldBeCommissioned}, is=${isCommissioned}`);
             return isMatch;
         });
     }

    console.log(`Final filtered device count: ${result.length}`);
    return result;
  }, [devices, searchTerm, filterProject, filterProvisioned, filterCommissioned]); // Add new filters to dependency array
  // --- END REFINED Filtering Logic ---

  const projects = useMemo(() => {
    const projectSet = new Set(devices.map(d => d.identity?.PROJECT || 'Unassigned'));
    return ['all', ...Array.from(projectSet).sort()];
  }, [devices]);

  // --- Filter Button Click Handler ---
  const handleFilterClick = (filterType, value) => {
    if (filterType === 'provisioned') {
        // If the clicked value is already active, toggle to 'all', otherwise set to clicked value
        setFilterProvisioned(prev => prev === value ? 'all' : value);
    } else if (filterType === 'commissioned') {
        // If the clicked value is already active, toggle to 'all', otherwise set to clicked value
        setFilterCommissioned(prev => prev === value ? 'all' : value);
    }
  };
  // --- End Filter Button Click Handler ---

  if (loading) return <LoadingSpinner fullPage={false} />;
  if (error) return <p className={styles.error}>{error}</p>;

  return (
      <div className={styles.deviceListContainer}>
        <div className={styles.controls}>
          {/* Search Input */}
          <input
            type="text"
            placeholder="Search Apartment, ID, Serial, Name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
          />
          {/* Project Filter */}
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className={styles.selectInput}
            title="Filter by Project"
          >
            {projects.map(proj => (
              <option key={proj} value={proj}>{proj === 'all' ? 'All Projects' : proj}</option>
            ))}
          </select>

          {/* Filter Toggle Buttons */}
          <div className={styles.filterButtonGroup} title="Filter by Provisioned Status">
              <span>Provisioned:</span>
              <button onClick={() => handleFilterClick('provisioned', 'all')} className={`${styles.filterButton} ${filterProvisioned === 'all' ? styles.activeFilterButton : ''}`}>All</button>
              <button onClick={() => handleFilterClick('provisioned', 'yes')} className={`${styles.filterButton} ${filterProvisioned === 'yes' ? styles.activeFilterButton : ''}`}>Yes</button>
              <button onClick={() => handleFilterClick('provisioned', 'no')} className={`${styles.filterButton} ${filterProvisioned === 'no' ? styles.activeFilterButton : ''}`}>No</button>
          </div>

          <div className={styles.filterButtonGroup} title="Filter by Commissioned Status">
              <span>Commissioned:</span>
              <button onClick={() => handleFilterClick('commissioned', 'all')} className={`${styles.filterButton} ${filterCommissioned === 'all' ? styles.activeFilterButton : ''}`}>All</button>
              <button onClick={() => handleFilterClick('commissioned', 'yes')} className={`${styles.filterButton} ${filterCommissioned === 'yes' ? styles.activeFilterButton : ''}`}>Yes</button>
              <button onClick={() => handleFilterClick('commissioned', 'no')} className={`${styles.filterButton} ${filterCommissioned === 'no' ? styles.activeFilterButton : ''}`}>No</button>
          </div>
          {/* End Filter Toggle Buttons */}

          {/* View Toggle Button */}
          <button
            onClick={() => setViewMode(viewMode === 'card' ? 'list' : 'card')}
            className={`${styles.controlButton} ${styles.viewToggle}`}
            title="Switch between card and list view"
          >
            {viewMode === 'card' ? 'List View' : 'Card View'}
          </button>
          {/* Add Device Button */}
          <button
            onClick={() => router.push('/devices/add')}
            className={`${styles.controlButton} ${styles.addDeviceButton}`}
            title="Add a new device entry"
          >
            + Add Device
          </button>
        </div>

        {/* Render Logic (Grid/List View) */}
        {filteredDevices.length === 0 ? (
          <p>No devices found matching your criteria.</p>
        ) : viewMode === 'card' ? (
          <div className={styles.grid}>
            {filteredDevices.map(device => (
              <DeviceCard key={device.id} device={device} />
            ))}
          </div>
        ) : (
          <div className={styles.listView}>
            {filteredDevices.map(device => (
              <div key={device.id} className={styles.listItem}>
                <DeviceCard device={device} />
              </div>
            ))}
          </div>
        )}
      </div>
  );
}