// הצהרות טיפוס ל-File System Access API. TypeScript מכיר את FileSystemDirectoryHandle
// עצמו, אבל לא את showDirectoryPicker ולא את מנגנון ההרשאות שסביבו - שניהם עדיין לא
// חלק מה-lib הסטנדרטי. ההצהרות כאן מצומצמות בכוונה למה שבשימוש בפועל
// (ר' src/lib/folderAccess.ts), כדי שלא ייווצר רושם שנתמך יותר ממה שנבדק.

type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: FileSystemPermissionMode;
  startIn?: FileSystemHandle | string;
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
