from pdf2docx import Converter

import argparse

# 创建 ArgumentParser 对象
parser = argparse.ArgumentParser(description='')
# 添加参数
parser.add_argument('--pdf', type=str, required=True, help='Path to the input file')
parser.add_argument('--docx', type=str, default='output.docx', help='Path to the output file')
args = parser.parse_args()

pdf_file = args.pdf
docx_file = args.docx

cv = Converter(pdf_file)
cv.convert(docx_file,layout=True)
cv.close()