from PIL import Image
import argparse

# 创建 ArgumentParser 对象
parser = argparse.ArgumentParser(description='')
# 添加参数
parser.add_argument('--pic', type=str, required=True, help='Path to the input file')
parser.add_argument('--pdf', type=str, default='output.pdf', help='Path to the output file')
args = parser.parse_args()
image_path = args.pic
pdf_path = args.pdf
image = Image.open(image_path)
image.save(pdf_path, 'PDF', resolution=100.0)
print("done")