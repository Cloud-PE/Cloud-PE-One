// 允许Windows API风格的命名
#![allow(non_snake_case)]
#![allow(non_camel_case_types)]
#![allow(non_upper_case_globals)]

use reqwest;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;
use sysinfo::Disks;
use tauri::command;

use crate::download::download_plugin_file;
use std::path::PathBuf;

use std::ffi::{OsStr, OsString};
use std::mem;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::ptr;
use winapi::shared::minwindef::{BYTE, DWORD, HKEY, LPBYTE};
use winapi::shared::winerror::ERROR_SUCCESS;
use winapi::um::fileapi::{
    CreateFileW, FindFirstVolumeW, FindNextVolumeW, FindVolumeClose, OPEN_EXISTING,
};
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::ioapiset::DeviceIoControl;
use winapi::um::winnt::{
    FILE_ATTRIBUTE_DIRECTORY, FILE_SHARE_READ, FILE_SHARE_WRITE, GENERIC_READ, HANDLE,
};
use winapi::um::winreg::{RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_LOCAL_MACHINE};
use winapi::um::winbase::SetVolumeLabelW;

const BusTypeUsb: DWORD = 0x07;

#[derive(Debug, Serialize, Deserialize)]
pub struct UsbDevice {
    phydrive: u32,
    name: String,
    #[serde(rename = "skipSelect")]
    skip_select: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse {
    success: bool,
    message: String,
    data: Option<Value>,
}

fn to_wide_string(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn format_size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit_index = 0;

    while size >= 1024.0 && unit_index < UNITS.len() - 1 {
        size /= 1024.0;
        unit_index += 1;
    }

    if unit_index >= 2 {
        format!("{:.0}{}", size, UNITS[unit_index])
    } else {
        format!("{:.1}{}", size, UNITS[unit_index])
    }
}

fn get_physical_drive_number(disk_path: &str) -> Option<u32> {
    let mount_point = disk_path.trim_end_matches('\\');

    if mount_point.len() == 2 && mount_point.ends_with(':') {
        println!("特殊分区格式: {}", mount_point);
    }

    unsafe {
        let volume_path = format!("\\\\.\\{}", mount_point);
        let wide_path = to_wide_string(&volume_path);

        let h_volume = CreateFileW(
            wide_path.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null_mut(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        );

        if h_volume == INVALID_HANDLE_VALUE {
            println!("无法打开卷 {}", volume_path);
            return None;
        }

        let mut storage_device_number: STORAGE_DEVICE_NUMBER = mem::zeroed();
        let mut bytes_returned: DWORD = 0;

        let result = DeviceIoControl(
            h_volume,
            IOCTL_STORAGE_GET_DEVICE_NUMBER,
            ptr::null_mut(),
            0,
            &mut storage_device_number as *mut _ as *mut _,
            mem::size_of::<STORAGE_DEVICE_NUMBER>() as DWORD,
            &mut bytes_returned,
            ptr::null_mut(),
        );

        CloseHandle(h_volume);

        if result != 0 && storage_device_number.DeviceType == FILE_DEVICE_DISK {
            println!(
                "卷 {} 对应物理驱动器 {}",
                mount_point, storage_device_number.DeviceNumber
            );
            Some(storage_device_number.DeviceNumber)
        } else {
            println!("无法获取卷 {} 的物理驱动器编号", mount_point);
            None
        }
    }
}

fn get_physical_drive_number_from_path(drive_number: u32) -> Option<u32> {
    unsafe {
        let physical_path = format!("\\\\.\\PHYSICALDRIVE{}", drive_number);
        let wide_path = to_wide_string(&physical_path);

        let h_drive = CreateFileW(
            wide_path.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null_mut(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        );

        if h_drive == INVALID_HANDLE_VALUE {
            return None;
        }

        CloseHandle(h_drive);
        Some(drive_number)
    }
}

const FILE_DEVICE_DISK: DWORD = 0x00000007;
const fn CTL_CODE(device_type: DWORD, function: DWORD, method: DWORD, access: DWORD) -> DWORD {
    (device_type << 16) | (access << 14) | (function << 2) | method
}
const METHOD_BUFFERED: DWORD = 0;
const FILE_ANY_ACCESS: DWORD = 0;
const IOCTL_STORAGE_GET_DEVICE_NUMBER: DWORD =
    CTL_CODE(0x0000002d, 0x0420, METHOD_BUFFERED, FILE_ANY_ACCESS);
const IOCTL_STORAGE_QUERY_PROPERTY: DWORD =
    CTL_CODE(0x0000002d, 0x0500, METHOD_BUFFERED, FILE_ANY_ACCESS);
const IOCTL_DISK_GET_DRIVE_GEOMETRY_EX: DWORD =
    CTL_CODE(FILE_DEVICE_DISK, 0x0028, METHOD_BUFFERED, FILE_ANY_ACCESS);

#[repr(C)]
struct STORAGE_DEVICE_NUMBER {
    DeviceType: DWORD,
    DeviceNumber: DWORD,
    PartitionNumber: DWORD,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct STORAGE_PROPERTY_QUERY {
    PropertyId: DWORD,
    QueryType: DWORD,
    AdditionalParameters: [BYTE; 1],
}

#[repr(C)]
struct STORAGE_DEVICE_DESCRIPTOR {
    Version: DWORD,
    Size: DWORD,
    DeviceType: BYTE,
    DeviceTypeModifier: BYTE,
    RemovableMedia: BYTE,
    CommandQueueing: BYTE,
    VendorIdOffset: DWORD,
    ProductIdOffset: DWORD,
    ProductRevisionOffset: DWORD,
    SerialNumberOffset: DWORD,
    BusType: DWORD,
    RawPropertiesLength: DWORD,
    RawDeviceProperties: [BYTE; 1],
}

const StorageDeviceProperty: DWORD = 0;
const PropertyStandardQuery: DWORD = 0;

#[repr(C)]
struct DISK_GEOMETRY {
    Cylinders: i64,
    MediaType: DWORD,
    TracksPerCylinder: DWORD,
    SectorsPerTrack: DWORD,
    BytesPerSector: DWORD,
}

#[repr(C)]
struct DISK_GEOMETRY_EX {
    Geometry: DISK_GEOMETRY,
    DiskSize: i64,
    Data: [BYTE; 1],
}

fn check_partition_for_ventoy_by_volume_path(volume_path: &str) -> bool {
    unsafe {
        let wide_path = to_wide_string(volume_path);
        let h_volume = CreateFileW(
            wide_path.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            ptr::null_mut(),
        );

        if h_volume == INVALID_HANDLE_VALUE {
            println!("无法打开卷: {}", volume_path);
            return false;
        }

        let result = check_ventoy_directories_with_handle(h_volume, volume_path);
        CloseHandle(h_volume);
        result
    }
}

fn check_ventoy_directories_with_handle(_h_volume: HANDLE, volume_path: &str) -> bool {
    unsafe {
        let paths_to_check = ["EFI", "grub", "tool", "ventoy"];
        let mut found_count = 0;

        for dir_name in &paths_to_check {
            let dir_path = format!("{}\\{}", volume_path.trim_end_matches('\\'), dir_name);
            let wide_path = to_wide_string(&dir_path);

            let attrs = GetFileAttributesW(wide_path.as_ptr());
            if attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0 {
                println!("  找到目录: {}", dir_path);
                found_count += 1;
            }
        }

        println!("  在 {} 找到 {}/4 个Ventoy目录", volume_path, found_count);
        found_count == 4
    }
}

fn check_all_volumes_for_ventoy(disk_number: u32) -> bool {
    unsafe {
        let mut volume_name: [u16; 50] = [0; 50];
        let h_find = FindFirstVolumeW(volume_name.as_mut_ptr(), 50);

        if h_find == INVALID_HANDLE_VALUE {
            return false;
        }

        loop {
            let volume = OsString::from_wide(&volume_name[..])
                .to_string_lossy()
                .trim_matches('\0')
                .to_string();

            println!("检查卷: {}", volume);

            let volume_trimmed = volume.trim_end_matches('\\');
            let wide_volume = to_wide_string(volume_trimmed);

            let h_volume = CreateFileW(
                wide_volume.as_ptr(),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            );

            if h_volume != INVALID_HANDLE_VALUE {
                let mut storage_device_number: STORAGE_DEVICE_NUMBER = mem::zeroed();
                let mut bytes_returned: DWORD = 0;

                let result = DeviceIoControl(
                    h_volume,
                    IOCTL_STORAGE_GET_DEVICE_NUMBER,
                    ptr::null_mut(),
                    0,
                    &mut storage_device_number as *mut _ as *mut _,
                    mem::size_of::<STORAGE_DEVICE_NUMBER>() as DWORD,
                    &mut bytes_returned,
                    ptr::null_mut(),
                );

                CloseHandle(h_volume);

                if result != 0
                    && storage_device_number.DeviceType == FILE_DEVICE_DISK
                    && storage_device_number.DeviceNumber == disk_number
                {
                    println!("  卷 {} 属于磁盘 {}", volume, disk_number);

                    if check_partition_for_ventoy_by_volume_path(volume_trimmed) {
                        FindVolumeClose(h_find);
                        return true;
                    }
                }
            }

            if FindNextVolumeW(h_find, volume_name.as_mut_ptr(), 50) == 0 {
                break;
            }
        }

        FindVolumeClose(h_find);
        false
    }
}

fn is_ventoy_device(disk_number: u32) -> bool {
    println!("检查磁盘 {} 是否为Ventoy设备...", disk_number);

    let disks = Disks::new_with_refreshed_list();
    for disk in disks.iter() {
        let mount_point = disk.mount_point().to_str().unwrap_or("");
        if let Some(drive_num) = get_physical_drive_number(mount_point) {
            if drive_num == disk_number {
                if !mount_point.is_empty() {
                    let mount_with_slash = if mount_point.ends_with('\\') {
                        mount_point.to_string()
                    } else {
                        format!("{}\\", mount_point)
                    };

                    if check_partition_for_ventoy(&mount_with_slash) {
                        println!("磁盘 {} 通过文件结构识别为Ventoy设备", disk_number);
                        return true;
                    }
                }
            }
        }
    }

    if check_all_volumes_for_ventoy(disk_number) {
        println!("磁盘 {} 通过卷枚举识别为Ventoy设备", disk_number);
        return true;
    }

    println!("磁盘 {} 不是Ventoy设备", disk_number);
    false
}

const INVALID_FILE_ATTRIBUTES: DWORD = 0xFFFFFFFF;
const FILE_FLAG_BACKUP_SEMANTICS: DWORD = 0x02000000;

extern "system" {
    fn GetFileAttributesW(lpFileName: *const u16) -> DWORD;
}

fn check_partition_for_ventoy(volume_path: &str) -> bool {
    let base_path = if volume_path.ends_with('\\') {
        volume_path.to_string()
    } else {
        format!("{}\\", volume_path)
    };

    let efi_path = format!("{}EFI", base_path);
    let grub_path = format!("{}grub", base_path);
    let tool_path = format!("{}tool", base_path);
    let ventoy_path = format!("{}ventoy", base_path);

    println!("检查Ventoy文件结构:");
    println!("  基础路径: {}", base_path);
    println!("  EFI路径: {}", efi_path);
    println!("  grub路径: {}", grub_path);
    println!("  tool路径: {}", tool_path);
    println!("  ventoy路径: {}", ventoy_path);

    let efi_exists = Path::new(&efi_path).exists();
    let grub_exists = Path::new(&grub_path).exists();
    let tool_exists = Path::new(&tool_path).exists();
    let ventoy_exists = Path::new(&ventoy_path).exists();

    println!("  EFI存在: {}", efi_exists);
    println!("  grub存在: {}", grub_exists);
    println!("  tool存在: {}", tool_exists);
    println!("  ventoy存在: {}", ventoy_exists);

    if efi_exists && grub_exists && tool_exists && ventoy_exists {
        println!("  检测到Ventoy文件结构!");
        return true;
    }

    false
}

fn is_usb_disk(disk_number: u32) -> bool {
    unsafe {
        let device_path = format!("\\\\.\\PHYSICALDRIVE{}", disk_number);
        let wide_path = to_wide_string(&device_path);

        let h_device = CreateFileW(
            wide_path.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null_mut(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        );

        if h_device == INVALID_HANDLE_VALUE {
            println!("无法打开磁盘 {}", disk_number);
            return false;
        }

        let mut query: STORAGE_PROPERTY_QUERY = mem::zeroed();
        query.PropertyId = StorageDeviceProperty;
        query.QueryType = PropertyStandardQuery;

        let mut buffer: [BYTE; 1024] = [0; 1024];
        let mut bytes_returned: DWORD = 0;

        let result = DeviceIoControl(
            h_device,
            IOCTL_STORAGE_QUERY_PROPERTY,
            &query as *const _ as *mut _,
            mem::size_of::<STORAGE_PROPERTY_QUERY>() as DWORD,
            buffer.as_mut_ptr() as *mut _,
            buffer.len() as DWORD,
            &mut bytes_returned,
            ptr::null_mut(),
        );

        CloseHandle(h_device);

        if result != 0 && bytes_returned >= mem::size_of::<STORAGE_DEVICE_DESCRIPTOR>() as DWORD {
            let descriptor = &*(buffer.as_ptr() as *const STORAGE_DEVICE_DESCRIPTOR);

            println!(
                "磁盘 {} - 总线类型: {}, 可移动媒体: {}",
                disk_number, descriptor.BusType, descriptor.RemovableMedia
            );

            if descriptor.BusType == BusTypeUsb {
                println!("磁盘 {} 是USB设备 (BusType = USB)", disk_number);
                return true;
            }

            if descriptor.RemovableMedia != 0 {
                println!("磁盘 {} 是可移动设备", disk_number);
                return true;
            }

            if descriptor.ProductIdOffset > 0 && descriptor.ProductIdOffset < bytes_returned {
                let product_ptr = buffer.as_ptr().offset(descriptor.ProductIdOffset as isize);
                let mut product_len = 0;
                while *product_ptr.offset(product_len) != 0 && product_len < 256 {
                    product_len += 1;
                }
                if product_len > 0 {
                    let product_slice =
                        std::slice::from_raw_parts(product_ptr, product_len as usize);
                    if let Ok(product) = std::str::from_utf8(product_slice) {
                        println!("磁盘 {} 产品: {}", disk_number, product.trim());
                    }
                }
            }
        } else {
            println!("无法获取磁盘 {} 的属性信息", disk_number);
        }

        if disk_number > 0 {
            let reg_path = format!("SYSTEM\\CurrentControlSet\\Services\\disk\\Enum");
            let wide_reg_path = to_wide_string(&reg_path);
            let mut h_key: HKEY = ptr::null_mut();

            let reg_result = RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                wide_reg_path.as_ptr(),
                0,
                winapi::um::winnt::KEY_READ,
                &mut h_key,
            );

            if reg_result == ERROR_SUCCESS as i32 {
                let value_name = to_wide_string(&disk_number.to_string());
                let mut buffer: [u16; 512] = [0; 512];
                let mut buffer_size = (buffer.len() * 2) as DWORD;
                let mut value_type: DWORD = 0;

                let query_result = RegQueryValueExW(
                    h_key,
                    value_name.as_ptr(),
                    ptr::null_mut(),
                    &mut value_type,
                    buffer.as_mut_ptr() as LPBYTE,
                    &mut buffer_size,
                );

                RegCloseKey(h_key);

                if query_result == ERROR_SUCCESS as i32 {
                    let device_id = OsString::from_wide(&buffer[..buffer_size as usize / 2 - 1])
                        .to_string_lossy()
                        .to_string();

                    println!("磁盘 {} 设备ID: {}", disk_number, device_id);

                    if device_id.to_uppercase().contains("USB")
                        || device_id.to_uppercase().contains("USBSTOR")
                    {
                        println!("磁盘 {} 通过设备ID识别为USB设备", disk_number);
                        return true;
                    }
                }
            }

            println!("磁盘 {} 使用宽松检测模式（非系统盘）", disk_number);
            return true;
        }

        false
    }
}

fn get_disk_info(disk_number: u32) -> String {
    unsafe {
        let device_path = format!("\\\\.\\PHYSICALDRIVE{}", disk_number);
        let wide_path = to_wide_string(&device_path);

        let h_device = CreateFileW(
            wide_path.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null_mut(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        );

        if h_device == INVALID_HANDLE_VALUE {
            return "USB Storage Device".to_string();
        }

        let mut query: STORAGE_PROPERTY_QUERY = mem::zeroed();
        query.PropertyId = StorageDeviceProperty;
        query.QueryType = PropertyStandardQuery;

        let mut buffer: [BYTE; 1024] = [0; 1024];
        let mut bytes_returned: DWORD = 0;

        let result = DeviceIoControl(
            h_device,
            IOCTL_STORAGE_QUERY_PROPERTY,
            &query as *const _ as *mut _,
            mem::size_of::<STORAGE_PROPERTY_QUERY>() as DWORD,
            buffer.as_mut_ptr() as *mut _,
            buffer.len() as DWORD,
            &mut bytes_returned,
            ptr::null_mut(),
        );

        CloseHandle(h_device);

        if result != 0 && bytes_returned >= mem::size_of::<STORAGE_DEVICE_DESCRIPTOR>() as DWORD {
            let descriptor = &*(buffer.as_ptr() as *const STORAGE_DEVICE_DESCRIPTOR);

            let mut device_name = String::new();

            if descriptor.VendorIdOffset > 0 && descriptor.VendorIdOffset < bytes_returned {
                let vendor_ptr = buffer.as_ptr().offset(descriptor.VendorIdOffset as isize);
                let mut vendor_len = 0;
                while *vendor_ptr.offset(vendor_len) != 0 && vendor_len < 256 {
                    vendor_len += 1;
                }
                if vendor_len > 0 {
                    let vendor_slice = std::slice::from_raw_parts(vendor_ptr, vendor_len as usize);
                    if let Ok(vendor) = std::str::from_utf8(vendor_slice) {
                        device_name.push_str(vendor.trim());
                        device_name.push(' ');
                    }
                }
            }

            if descriptor.ProductIdOffset > 0 && descriptor.ProductIdOffset < bytes_returned {
                let product_ptr = buffer.as_ptr().offset(descriptor.ProductIdOffset as isize);
                let mut product_len = 0;
                while *product_ptr.offset(product_len) != 0 && product_len < 256 {
                    product_len += 1;
                }
                if product_len > 0 {
                    let product_slice =
                        std::slice::from_raw_parts(product_ptr, product_len as usize);
                    if let Ok(product) = std::str::from_utf8(product_slice) {
                        device_name.push_str(product.trim());
                    }
                }
            }

            if !device_name.is_empty() {
                return device_name;
            }
        }

        "USB Storage Device".to_string()
    }
}

fn get_disk_size(disk_number: u32) -> u64 {
    unsafe {
        let device_path = format!("\\\\.\\PHYSICALDRIVE{}", disk_number);
        let wide_path = to_wide_string(&device_path);

        let h_device = CreateFileW(
            wide_path.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null_mut(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        );

        if h_device == INVALID_HANDLE_VALUE {
            return 0;
        }

        let mut disk_geometry_ex: DISK_GEOMETRY_EX = mem::zeroed();
        let mut bytes_returned: DWORD = 0;

        let result = DeviceIoControl(
            h_device,
            IOCTL_DISK_GET_DRIVE_GEOMETRY_EX,
            ptr::null_mut(),
            0,
            &mut disk_geometry_ex as *mut _ as *mut _,
            mem::size_of::<DISK_GEOMETRY_EX>() as DWORD,
            &mut bytes_returned,
            ptr::null_mut(),
        );

        CloseHandle(h_device);

        if result != 0 {
            disk_geometry_ex.DiskSize as u64
        } else {
            0
        }
    }
}

fn get_all_partitions_for_disk(disk_number: u32, disks: &Disks) -> Vec<String> {
    let mut partitions = Vec::new();

    println!("查找磁盘 {} 的所有分区...", disk_number);

    for disk in disks.iter() {
        let mount_point = disk.mount_point().to_str().unwrap_or("");
        let label = disk.name().to_string_lossy();
        println!("  检查分区: {} (标签: {})", mount_point, label);

        if let Some(drive_num) = get_physical_drive_number(mount_point) {
            println!("    物理驱动器编号: {}", drive_num);
            if drive_num == disk_number {
                if mount_point.len() >= 2 {
                    let drive_letter = mount_point.trim_end_matches('\\').to_string();
                    if !partitions.contains(&drive_letter) {
                        partitions.push(drive_letter.clone());
                        println!("    添加分区: {}", drive_letter);
                    }
                }
            }
        }
    }

    partitions.sort();
    println!(
        "磁盘 {} 找到 {} 个分区: {:?}",
        disk_number,
        partitions.len(),
        partitions
    );
    partitions
}

#[command]
pub async fn get_usb_devices() -> Result<Vec<UsbDevice>, String> {
    let mut devices = Vec::new();
    let disks = Disks::new_with_refreshed_list();

    let mut processed_disks = std::collections::HashSet::new();

    for disk_number in 0..128u32 {
        if get_physical_drive_number_from_path(disk_number).is_none() {
            continue;
        }

        if !is_usb_disk(disk_number) {
            continue;
        }

        if processed_disks.contains(&disk_number) {
            continue;
        }
        processed_disks.insert(disk_number);

        let model = get_disk_info(disk_number);
        let disk_size = get_disk_size(disk_number);

        let all_partitions = get_all_partitions_for_disk(disk_number, &disks);

        let mut total_size = disk_size;
        if !all_partitions.is_empty() && disk_size == 0 {
            total_size = 0;
            for partition in &all_partitions {
                for d in disks.iter() {
                    if d.mount_point()
                        .to_str()
                        .unwrap_or("")
                        .trim_end_matches('\\')
                        == partition
                    {
                        total_size += d.total_space();
                        break;
                    }
                }
            }
        }

        let skip_select = is_ventoy_device(disk_number);

        if skip_select {
            println!("磁盘 {} 识别为Ventoy设备", disk_number);
        }

        let base_name = if all_partitions.is_empty() {
            format!("[{}] {}", format_size(total_size), model)
        } else {
            format!(
                "{} [{}] {}",
                all_partitions.join(" "),
                format_size(total_size),
                model
            )
        };

        let name = if skip_select {
            format!("{} (Ventoy)", base_name)
        } else {
            base_name
        };

        devices.push(UsbDevice {
            phydrive: disk_number,
            name,
            skip_select,
        });

        println!(
            "检测到USB设备: PhysicalDrive{} - {} (Ventoy: {})",
            disk_number, model, skip_select
        );
    }

    if devices.is_empty() {
        Err("未检测到任何USB存储设备".to_string())
    } else {
        devices.sort_by_key(|d| d.phydrive);
        println!("检测到 {} 个USB存储设备", devices.len());
        Ok(devices)
    }
}

#[command]
pub async fn get_system_boot_mode() -> Result<String, String> {
    unsafe {
        let firmware_type_path =
            to_wide_string("SYSTEM\\CurrentControlSet\\Control\\SecureBoot\\State");
        let mut h_key: HKEY = ptr::null_mut();

        let result = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            firmware_type_path.as_ptr(),
            0,
            winapi::um::winnt::KEY_READ,
            &mut h_key,
        );

        if result == ERROR_SUCCESS as i32 {
            RegCloseKey(h_key);
            return Ok("UEFI".to_string());
        }

        let efi_path = to_wide_string("SYSTEM\\CurrentControlSet\\Control");
        let mut efi_key: HKEY = ptr::null_mut();

        let efi_result = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            efi_path.as_ptr(),
            0,
            winapi::um::winnt::KEY_READ,
            &mut efi_key,
        );

        if efi_result == ERROR_SUCCESS as i32 {
            let value_name = to_wide_string("PEFirmwareType");
            let mut value_type: DWORD = 0;
            let mut value_data: DWORD = 0;
            let mut value_size = mem::size_of::<DWORD>() as DWORD;

            let query_result = RegQueryValueExW(
                efi_key,
                value_name.as_ptr(),
                ptr::null_mut(),
                &mut value_type,
                &mut value_data as *mut _ as LPBYTE,
                &mut value_size,
            );

            RegCloseKey(efi_key);

            if query_result == ERROR_SUCCESS as i32 {
                if value_data == 2 {
                    return Ok("UEFI".to_string());
                }
            }
        }

        let env_path =
            to_wide_string("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment");
        let mut env_key: HKEY = ptr::null_mut();

        let env_result = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            env_path.as_ptr(),
            0,
            winapi::um::winnt::KEY_READ,
            &mut env_key,
        );

        if env_result == ERROR_SUCCESS as i32 {
            let firmware_value = to_wide_string("firmware_type");
            let mut buffer: [u16; 256] = [0; 256];
            let mut buffer_size = (buffer.len() * 2) as DWORD;
            let mut value_type: DWORD = 0;

            let query_result = RegQueryValueExW(
                env_key,
                firmware_value.as_ptr(),
                ptr::null_mut(),
                &mut value_type,
                buffer.as_mut_ptr() as LPBYTE,
                &mut buffer_size,
            );

            RegCloseKey(env_key);

            if query_result == ERROR_SUCCESS as i32 {
                let value_str = OsString::from_wide(&buffer[..buffer_size as usize / 2])
                    .to_string_lossy()
                    .to_string();
                if value_str.to_uppercase().contains("UEFI") {
                    return Ok("UEFI".to_string());
                }
            }
        }
    }

    Ok("MBR".to_string())
}

#[command]
pub async fn deploy_to_usb(drive_letter: String) -> Result<ApiResponse, String> {
    println!("开始部署到USB驱动器: {}", drive_letter);

    let drive_path = if drive_letter.ends_with(":\\") {
        drive_letter.clone()
    } else if drive_letter.ends_with(":") {
        format!("{}\\", drive_letter)
    } else {
        format!("{}:\\", drive_letter)
    };

    if !Path::new(&drive_path).exists() {
        return Err(format!("驱动器 {} 不存在", drive_letter));
    }

    let cloud_pe_path = format!("{}cloud-pe", drive_path);
    let ce_apps_path = format!("{}ce-apps", drive_path);

    match fs::create_dir_all(&cloud_pe_path) {
        Ok(_) => println!("创建文件夹成功: {}", cloud_pe_path),
        Err(e) => return Err(format!("创建cloud-pe文件夹失败: {}", e)),
    }

    match fs::create_dir_all(&ce_apps_path) {
        Ok(_) => println!("创建文件夹成功: {}", ce_apps_path),
        Err(e) => return Err(format!("创建ce-apps文件夹失败: {}", e)),
    }

    let pe_version = match get_pe_version().await {
        Ok(version) => version,
        Err(e) => {
            println!("获取PE版本失败，使用默认版本: {}", e);
            "1.0.0".to_string()
        }
    };

    let config = serde_json::json!({
        "pe":{
            "drive": drive_letter,
            "version": pe_version,
            "folders_created": [cloud_pe_path, ce_apps_path],
        }
    });

    let config_path = format!("{}\\config.json", cloud_pe_path);
    match fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap()) {
        Ok(_) => println!("配置文件创建成功: {}", config_path),
        Err(e) => return Err(format!("创建配置文件失败: {}", e)),
    }

    let autorun_path = format!("{}autorun.inf", drive_path);
    let content = "[autorun]\nicon=cloud-pe\\cloud-pe.ico";
    match fs::write(&autorun_path, content) {
        Ok(_) => println!("autorun.inf 创建成功"),
        Err(e) => println!("autorun.inf 创建失败，跳过: {}", e),
    }

    const EMBEDDED_ICON: &[u8] = include_bytes!("../icons/icon.ico");
    let ico_path = format!("{}cloud-pe\\cloud-pe.ico", drive_path);
    match fs::write(&ico_path, EMBEDDED_ICON) {
        Ok(_) => println!("图标文件创建成功"),
        Err(e) => println!("图标文件创建失败，跳过: {}", e),
    }

    println!("设置驱动器卷标为 Cloud-PE...");
    unsafe {
        let wide_drive_path = to_wide_string(&drive_path);
        let wide_label = to_wide_string("Cloud-PE");
        
        let result = SetVolumeLabelW(wide_drive_path.as_ptr(), wide_label.as_ptr());
        if result == 0 {
            println!("设置卷标失败，但部署继续");
        } else {
            println!("卷标设置成功");
        }
    }

    println!("开始下载默认插件...");
    match get_and_download_default_plugin(&ce_apps_path).await {
        Ok(downloaded_file) => {
            println!("默认插件下载成功: {}", downloaded_file);
        }
        Err(e) => {
            println!("默认插件下载失败，但部署继续: {}", e);
        }
    }

    Ok(ApiResponse {
        success: true,
        message: format!("成功部署到您的U盘: {}", drive_letter),
        data: Some(serde_json::json!({
            "pe":{
                "drive": drive_letter,
                "version": pe_version,
                "folders_created": [cloud_pe_path, ce_apps_path],
            }
        })),
    })
}

async fn get_pe_version() -> Result<String, reqwest::Error> {
    let response = reqwest::get("https://api.cloud-pe.cn/GetInfo/").await?;
    let version: Value = response.json().await?;
    let version_str = version["data"]["cloud_pe"]
        .as_str()
        .unwrap_or("1.0")
        .to_string();

    Ok(version_str.replace("v", ""))
}

#[command]
pub async fn restart_app() -> Result<ApiResponse, String> {
    println!("重启应用程序...");

    match env::current_exe() {
        Ok(exe_path) => match Command::new(&exe_path).spawn() {
            Ok(_) => {
                tokio::spawn(async {
                    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
                    std::process::exit(0);
                });

                Ok(ApiResponse {
                    success: true,
                    message: "应用程序将在1秒后重启".to_string(),
                    data: None,
                })
            }
            Err(e) => Err(format!("重启失败: {}", e)),
        },
        Err(e) => Err(format!("获取程序路径失败: {}", e)),
    }
}

#[command]
pub async fn close_app() -> Result<ApiResponse, String> {
    println!("关闭应用程序...");

    tokio::spawn(async {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        std::process::exit(0);
    });

    Ok(ApiResponse {
        success: true,
        message: "应用程序将在0.5秒后关闭".to_string(),
        data: None,
    })
}

async fn get_and_download_default_plugin(ce_apps_path: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = match client
        .get("https://api.cloud-pe.cn/GetInfo/?m=1")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => return Err(format!("获取API信息失败: {}", e)),
    };

    let json_data: Value = match response.json().await {
        Ok(data) => data,
        Err(e) => return Err(format!("解析JSON失败: {}", e)),
    };

    let default_plugin_url = match json_data["default_plugin"].as_str() {
        Some(url) => url,
        None => return Err("未找到default_plugin字段".to_string()),
    };

    println!("默认插件下载链接: {}", default_plugin_url);

    let save_path = PathBuf::from(ce_apps_path);
    match download_plugin_file(
        default_plugin_url.to_string(),
        save_path,
        16,
    )
    .await
    {
        Ok(downloaded_path) => Ok(downloaded_path),
        Err(e) => Err(format!("下载失败: {}", e)),
    }
}
