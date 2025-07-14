"use client";

import { useState, useEffect, useCallback } from "react";
import { doc, onSnapshot, setDoc, collection, query } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";

import AuthGuard from "@/app/components/AuthGuard";
import LoadingSpinner from "@/app/components/LoadingSpinner";
import RecipientManager from "@/app/components/RecipientManager";
import EmailTemplateEditor from "@/app/components/EmailTemplateEditor";
import styles from "@/app/styles/Page.module.css";
import pageStyles from "./page.module.css";

const NOTIFICATION_CONFIG_PATH = "config/notifications";
const TEMPLATES_COLLECTION_PATH = "config/email_templates";

const defaultGlobalConfig = {
    email_enabled: true,
    sms_enabled: true,
    global_recipients: {
        emails: [],
        sms: []
    }
};

const templateTypes = ["leak-detected", "leak-cleared", "offline", "online", "manual-test"];

export default function SettingsPage() {
    const [globalConfig, setGlobalConfig] = useState(defaultGlobalConfig);
    const [templates, setTemplates] = useState({});
    const [activeTemplateId, setActiveTemplateId] = useState(templateTypes[0]);
    
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState("");

    // Fetch global notification settings
    useEffect(() => {
        const docRef = doc(db, NOTIFICATION_CONFIG_PATH);
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setGlobalConfig(docSnap.data());
            } else {
                // If it doesn't exist, use the default. It will be created on first save.
                setGlobalConfig(defaultGlobalConfig);
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);
    
    // Fetch all email templates
    useEffect(() => {
        const q = query(collection(db, TEMPLATES_COLLECTION_PATH));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const fetchedTemplates = {};
            querySnapshot.forEach((doc) => {
                fetchedTemplates[doc.id] = doc.data();
            });
            // Ensure all template types have at least a default object
            templateTypes.forEach(type => {
                if (!fetchedTemplates[type]) {
                    fetchedTemplates[type] = { subject: "", body: "" };
                }
            });
            setTemplates(fetchedTemplates);
        });
        return () => unsubscribe();
    }, []);

    const handleGlobalConfigChange = (field, value) => {
        setGlobalConfig(prev => ({ ...prev, [field]: value }));
    };
    
    const handleRecipientsChange = (recipientsData) => {
        setGlobalConfig(prev => ({ ...prev, global_recipients: recipientsData }));
    };
    
    const handleTemplateChange = useCallback((updatedTemplate) => {
        setTemplates(prev => ({
            ...prev,
            [activeTemplateId]: updatedTemplate
        }));
    }, [activeTemplateId]);

    const handleSaveAll = async () => {
        setIsSaving(true);
        setSaveStatus("Saving...");

        try {
            // Save global config
            const configDocRef = doc(db, NOTIFICATION_CONFIG_PATH);
            await setDoc(configDocRef, globalConfig, { merge: true });

            // Save all templates
            const templatePromises = Object.entries(templates).map(([id, data]) => {
                const templateDocRef = doc(db, TEMPLATES_COLLECTION_PATH, id);
                return setDoc(templateDocRef, data, { merge: true });
            });
            await Promise.all(templatePromises);
            
            setSaveStatus("All settings saved successfully!");
        } catch (error) {
            console.error("Failed to save settings:", error);
            setSaveStatus(`Error: ${error.message}`);
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveStatus(""), 3000);
        }
    };

    if (loading) {
        return <AuthGuard><LoadingSpinner /></AuthGuard>;
    }

    return (
        <AuthGuard>
            <div className={styles.container}>
                <h1>Global Settings</h1>
                <p>Manage application-wide notification settings and email templates.</p>

                <div className={pageStyles.settingsSection}>
                    <h2>Notification Channels</h2>
                    <div className={pageStyles.fieldGroup}>
                        <label htmlFor="email_enabled">Enable Email Notifications</label>
                        <input
                            type="checkbox"
                            id="email_enabled"
                            checked={globalConfig.email_enabled}
                            onChange={(e) => handleGlobalConfigChange('email_enabled', e.target.checked)}
                        />
                    </div>
                    <div className={pageStyles.fieldGroup}>
                        <label htmlFor="sms_enabled">Enable SMS Notifications</label>
                        <input
                            type="checkbox"
                            id="sms_enabled"
                            checked={globalConfig.sms_enabled}
                            onChange={(e) => handleGlobalConfigChange('sms_enabled', e.target.checked)}
                        />
                    </div>
                </div>

                <div className={pageStyles.settingsSection}>
                    <h2>Global Recipients</h2>
                    <p className={pageStyles.description}>These recipients will receive notifications for <strong>all</strong> devices, in addition to any device-specific recipients.</p>
                    <RecipientManager
                        initialData={globalConfig.global_recipients}
                        onSave={handleRecipientsChange}
                        onCancel={() => {}} // No cancel action needed here
                        isSaving={isSaving}
                    />
                </div>
                
                <div className={pageStyles.settingsSection}>
                    <h2>Email Templates</h2>
                     <div className={pageStyles.templateTabs}>
                        {templateTypes.map(type => (
                            <button
                                key={type}
                                className={activeTemplateId === type ? pageStyles.activeTab : ""}
                                onClick={() => setActiveTemplateId(type)}
                            >
                                {type.replace(/-/g, ' ')}
                            </button>
                        ))}
                    </div>
                    {templates[activeTemplateId] && (
                        <EmailTemplateEditor
                            key={activeTemplateId}
                            template={templates[activeTemplateId]}
                            onUpdate={handleTemplateChange}
                            isSaving={isSaving}
                        />
                    )}
                </div>

                <div className={pageStyles.saveActions}>
                    <button className="button" onClick={handleSaveAll} disabled={isSaving}>
                        {isSaving ? "Saving..." : "Save All Settings"}
                    </button>
                    {saveStatus && <span className={pageStyles.saveStatus}>{saveStatus}</span>}
                </div>
            </div>
        </AuthGuard>
    );
}