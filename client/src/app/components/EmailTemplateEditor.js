"use client";

import { useState, useEffect } from "react";
import styles from "./EmailTemplateEditor.module.css";

const availablePlaceholders = [
    { token: "{apartment}", description: "The name of the apartment or device." },
    { token: "{message}", description: "The core notification message from the device." },
    { token: "{triggeredAt}", description: "The timestamp when the event occurred." },
    { token: "{type}", description: "The type of notification (e.g., 'leak-detected')." },
    { token: "{status}", description: "The status associated with the event (e.g., 'active')." },
];

export default function EmailTemplateEditor({ template, onUpdate, isSaving }) {
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");

    useEffect(() => {
        setSubject(template.subject || "");
        setBody(template.body || "");
    }, [template]);
    
    const handleSubjectChange = (e) => {
        setSubject(e.target.value);
        onUpdate({ subject: e.target.value, body });
    };
    
    const handleBodyChange = (e) => {
        setBody(e.target.value);
        onUpdate({ subject, body: e.target.value });
    };

    return (
        <div className={styles.editorContainer}>
            <div className={styles.formSection}>
                <label htmlFor="subject">Email Subject</label>
                <input
                    id="subject"
                    type="text"
                    value={subject}
                    onChange={handleSubjectChange}
                    placeholder="Enter email subject"
                    disabled={isSaving}
                />

                <label htmlFor="body">Email Body (HTML)</label>
                <textarea
                    id="body"
                    value={body}
                    onChange={handleBodyChange}
                    placeholder="Enter the full HTML body of the email..."
                    rows="15"
                    disabled={isSaving}
                />
            </div>
            <div className={styles.placeholdersSection}>
                <h4>Available Placeholders</h4>
                <p>Use these tokens in your subject or body. They will be replaced with real data.</p>
                <ul>
                    {availablePlaceholders.map(p => (
                        <li key={p.token}>
                            <code>{p.token}</code>
                            <span>- {p.description}</span>
                        </li>
                    ))}
                </ul>
                 <div className={styles.backendNote}>
                    <strong>Note:</strong> Template processing is handled by the backend. Saving a template here makes it available for the notification function to use.
                </div>
            </div>
        </div>
    );
}