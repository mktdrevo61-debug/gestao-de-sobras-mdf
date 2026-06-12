import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDNVdT0wZJCj6qOX_o55Znir5YqQh84L7k",
  authDomain: "gestaosobras.firebaseapp.com",
  projectId: "gestaosobras",
  storageBucket: "gestaosobras.firebasestorage.app",
  messagingSenderId: "1001407154836",
  appId: "1:1001407154836:web:b81fe10de6343604b48281",
  measurementId: "G-L6K89LHN32"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
