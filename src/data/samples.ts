export interface SampleDraft {
    id: string;
    title: string;
    content: string;
    type: "sample" | "draft";
}

export const SAMPLES: SampleDraft[] = [
    {
        id: "sample_medical_1",
        title: "Medical Record Template",
        type: "sample",
        content: `Patient: John Doe (DOB: 1980-05-15)
Address: 123 Main St, Springfield, IL 62704
Visit Date: 2023-10-25
Hospital: Springfield General Hospital

History of Present Illness:
Mr. Doe presented with a 3-day history of fever and cough. He works as a teacher at Springfield Elementary. He denies recent travel.

Assessment:
Viral upper respiratory infection.

Plan:
Rest and hydration. Follow up with Dr. Smith if symptoms worsen.`
    },
    {
        id: "sample_clinical_note",
        title: "Clinical Note (Short)",
        type: "sample",
        content: `Subjective: Patient reports headache and nausea.
Objective: BP 120/80, HR 72. No visible distress.
Assessment: Tension headache.
Plan: Ibuprofen 400mg PRN.`
    },
    {
        id: "sample_research",
        title: "Research Abstract",
        type: "sample",
        content: `Study ID: VAC-2023-001
Principal Investigator: Dr. Alice Johnson
Site: University Hospital, Tokyo

Abstract:
This study evaluates the efficacy of the new vaccine in 500 participants aged 20-60. Participant A001 reported mild side effects.`
    }
];
