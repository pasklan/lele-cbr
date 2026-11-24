import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("package_windows", ROOT / "scripts/package_windows.py")
assert spec is not None and spec.loader is not None
packaging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packaging)


class PortablePackageTests(unittest.TestCase):
    def test_real_shipped_executable_does_not_require_visual_cpp_redistributable(self):
        from scripts.pe_dependencies import imported_dlls
        imports = imported_dlls((ROOT / "artifacts/LeitorLele.exe").read_bytes())
        self.assertIn("kernel32.dll", {name.lower() for name in imports})
        runtime = {name for name in imports if name.lower().startswith(("msvcp", "vcruntime", "concrt"))}
        self.assertEqual(runtime, set(), f"Non-system Visual C++ runtime dependencies: {runtime}")

    def test_refuses_to_package_a_non_windows_file_as_an_executable(self):
        scratch = ROOT / "target/test-fixtures"
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="portable-invalid-", dir=scratch) as temporary:
            output = Path(temporary) / "reader.zip"
            with self.assertRaises(ValueError):
                packaging.build_package(ROOT, ROOT / "Cargo.toml", output)
            self.assertFalse(output.exists())

    def test_packages_the_real_executable_and_notices_without_private_comics(self):
        scratch = ROOT / "target/test-fixtures"
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="portable-", dir=scratch) as temporary:
            output = Path(temporary) / "reader.zip"
            executable = ROOT / "artifacts/LeitorLele.exe"
            packaging.build_package(ROOT, executable, output)
            self.assertTrue(output.is_file(), "portable archive must be created")
            with zipfile.ZipFile(output) as archive:
                names = set(archive.namelist())
                self.assertIn("LeleCBR/LeitorLele.exe", names)
                self.assertIn("LeleCBR/UNRAR-LICENSE.txt", names)
                self.assertIn("LeleCBR/LEIA-ME.txt", names)
                self.assertIn("LeleCBR/SHA256SUMS.txt", names)
                self.assertIn("LeleCBR/abrir.cmd", names)
                self.assertEqual(archive.read("LeleCBR/LeitorLele.exe"), executable.read_bytes())
                self.assertFalse(any(name.lower().endswith((".cbr", ".cbz")) for name in names))
                self.assertFalse(any("node_modules" in name or "scratch" in name for name in names))
                self.assertIsNone(archive.testzip())
