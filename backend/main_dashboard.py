import cv2
import os
import pandas as pd
from mood_detection import ExtendedMoodClassroomMonitor
from attendance_system import AttendanceSystem
from face_registration import register_new_face


def view_summary():
    """Merges attendance and mood logs into a single view."""
    attendance_file = "attendance.csv"
    mood_file = "cognitive_load_log.csv"

    if not os.path.exists(attendance_file):
        print("❌ Attendance logs not found. Please run Attendance Monitor first.")
        return

    df_att = pd.read_csv(attendance_file)
    print("\n--- 📊 OVERALL CLASS SUMMARY ---")

    students = df_att['Name'].unique()

    for student in students:
        print(f"\n👤 Student: {student.upper()}")
        student_att = df_att[df_att['Name'] == student]

        has_status = 'Status' in df_att.columns

        for _, row in student_att.iterrows():
            status_text = row['Status'] if has_status else "Present (Legacy Record)"
            print(f"  [{row['Date']} {row['Time']}] - {status_text}")

        if os.path.exists(mood_file):
            df_mood = pd.read_csv(mood_file)
            student_mood = df_mood[df_mood['Name'] == student]
            if not student_mood.empty:
                print("  Recent Mood Trends:")
                last_moods = student_mood.tail(3)
                for _, row in last_moods.iterrows():
                    print(f"    - Time: {row['Timestamp']} | Attentiveness: {row['Attentiveness']} | Mood: {row['Mood']}")
            else:
                print("  No mood data recorded.")
        else:
            print("  No mood data recorded globally.")
    print("\n" + "=" * 30)


def main():
    attendance = AttendanceSystem()
    advanced_tracker = ExtendedMoodClassroomMonitor(attendance)

    while True:
        print("\n--- DASHBOARD ---")
        print("1: Register Face | 2: Mark Attendance | 3: Mood Monitor | 4: View Log Summary | 5: Exit")
        choice = input("👉 Select (1-5): ").strip()

        if choice == '1':
            name = input("\n👤 Enter name: ").strip()
            if name:
                register_new_face(name, dataset_dir=attendance.dataset_dir)
                attendance.load_registered_faces(attendance.dataset_dir)
        elif choice == '2':
            duration = input("⏱️ Duration (sec): ")
            attendance.run_attendance(duration)
        elif choice == '3':
            duration = input("⏱️ Duration (sec): ")
            advanced_tracker.run_monitoring_session(duration_seconds=int(duration))
        elif choice == '4':
            view_summary()
        elif choice == '5':
            break


if __name__ == "__main__":
    main()