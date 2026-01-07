use zeroize::Zeroize;

pub fn wipe_memory(data: &mut [u8]) {
    data.zeroize();
}
