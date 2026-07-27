import cv2
import os


def register_new_face(name, dataset_dir="registered_faces", num_angles=15):
    """Captures a set of face images for one person across different angles,
    to give the recognizer more to work with than a single frontal shot.
    Space bar captures each angle, 'q' cancels early."""
    person_folder = os.path.join(dataset_dir, name.lower())

    if not os.path.exists(person_folder):
        os.makedirs(person_folder)
    else:
        for f in os.listdir(person_folder):
            os.remove(os.path.join(person_folder, f))

    cap = cv2.VideoCapture(0)
    print(f"\n📸 Registration for {name.upper()}.")
    print("👉 Look in different directions (side, up, down, center).")
    print(f"👉 Press SPACE to capture each of the {num_angles} angles.")

    count = 0
    while count < num_angles:
        ret, frame = cap.read()
        if not ret:
            print("❌ Camera error!")
            break

        cv2.putText(frame, f"Angle {count + 1}/{num_angles} - SPACE to capture", (20, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        cv2.imshow("Multi-Angle Registration", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord(' '):
            file_path = os.path.join(person_folder, f"{name.lower()}_{count}.jpg")
            cv2.imwrite(file_path, frame)
            print(f"✅ Saved: {file_path}")
            count += 1
        elif key == ord('q'):
            print("❌ Registration cancelled.")
            break

    cap.release()
    cv2.destroyAllWindows()
    return count
