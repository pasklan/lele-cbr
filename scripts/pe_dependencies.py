"""Read normal PE import names to validate the actual shipped Windows binary."""
import struct


def imported_dlls(data: bytes) -> set[str]:
    pe = struct.unpack_from("<I", data, 60)[0]
    if data[:2] != b"MZ" or data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("Not a PE file")
    count = struct.unpack_from("<H", data, pe + 6)[0]
    optional_size = struct.unpack_from("<H", data, pe + 20)[0]
    optional = pe + 24
    if struct.unpack_from("<H", data, optional)[0] != 0x20B:
        raise ValueError("Expected a PE32+ image")
    sections = optional + optional_size

    def offset(rva: int) -> int:
        for number in range(count):
            virtual_size, virtual_address, raw_size, raw_address = struct.unpack_from(
                "<IIII", data, sections + number * 40 + 8
            )
            if virtual_address <= rva < virtual_address + max(virtual_size, raw_size):
                return raw_address + rva - virtual_address
        raise ValueError(f"Unmapped PE RVA: {rva}")

    import_rva, import_size = struct.unpack_from("<II", data, optional + 120)
    if not import_rva:
        return set()
    cursor = offset(import_rva)
    names = set()
    for _ in range(import_size // 20):
        descriptor = struct.unpack_from("<IIIII", data, cursor)
        if not any(descriptor):
            return names
        start = offset(descriptor[3])
        end = data.index(b"\0", start)
        names.add(data[start:end].decode("ascii"))
        cursor += 20
    raise ValueError("PE import directory has no terminator")
